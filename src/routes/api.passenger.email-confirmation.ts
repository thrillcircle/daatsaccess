import { createFileRoute } from "@tanstack/react-router";

const FROM = "Access by DAATS <noreply@daats.app>";
const SENDER_DOMAIN = "notify.daats.app";
const CODE_TTL_MINUTES = 10;

type RpcResponse<T> = Promise<{ data: T | null; error: { message: string } | null }>;
type UntypedRpc = <T>(name: string, args?: Record<string, unknown>) => RpcResponse<T>;

type BeginResult = {
  accepted: boolean;
  already_confirmed: boolean;
  retry_after_seconds: number;
};

type VerifyResult = {
  verified: boolean;
  reason: "confirmed" | "already_confirmed" | "no_challenge" | "expired" | "too_many_attempts" | "invalid_code";
  attempts_remaining: number;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function generateCode() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(values[0] % 1_000_000).padStart(6, "0");
}

async function hmacCode(secret: string, userId: string, email: string, code: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${userId}:${email.toLowerCase()}:${code}`),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function emailHtml(code: string) {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f7f7f8;font-family:Arial,sans-serif;color:#18181b">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px">
      <div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;padding:28px">
        <p style="margin:0 0 8px;font-size:14px;color:#71717a">Access by DAATS</p>
        <h1 style="margin:0 0 14px;font-size:24px">Confirm your Access account</h1>
        <p style="margin:0 0 20px;line-height:1.55">Enter this code in Access to confirm that this email belongs to you.</p>
        <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;background:#f4f4f5;border-radius:12px;padding:18px 10px">${code}</div>
        <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#71717a">The code expires in ${CODE_TTL_MINUTES} minutes. If you did not request it, you can ignore this email. Access will never ask you to send this code to a driver.</p>
      </div>
    </div>
  </body>
</html>`;
}

function emailText(code: string) {
  return `Confirm your Access account\n\nYour verification code is ${code}.\n\nIt expires in ${CODE_TTL_MINUTES} minutes. If you did not request it, ignore this email.`;
}

export const Route = createFileRoute("/api/passenger/email-confirmation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const token = bearerToken(request);
          if (!token) return json({ error: "Authentication required" }, 401);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
          const user = userData.user;
          if (userError || !user?.id || !user.email) {
            return json({ error: "Authentication required" }, 401);
          }

          const hasOauthVerification = (user.identities ?? []).some(
            (identity) => identity.provider === "google" || identity.provider === "apple",
          );
          if (hasOauthVerification) {
            return json({ verified: true, method: "oauth" });
          }

          const body = (await request.json().catch(() => ({}))) as {
            action?: "request" | "verify";
            code?: string;
          };
          const action = body.action;
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) return json({ error: "Email service is not configured" }, 503);

          const rpc = supabaseAdmin.rpc.bind(supabaseAdmin) as unknown as UntypedRpc;

          if (action === "request") {
            const code = generateCode();
            const challengeId = crypto.randomUUID();
            const codeHash = await hmacCode(apiKey, user.id, user.email, code);
            const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();
            const { data, error } = await rpc<BeginResult>("service_begin_passenger_email_challenge", {
              p_user_id: user.id,
              p_email: user.email,
              p_challenge_id: challengeId,
              p_code_hash: codeHash,
              p_expires_at: expiresAt,
            });
            if (error) throw new Error(error.message);
            if (!data) throw new Error("Could not create an email confirmation challenge");
            if (data.already_confirmed) return json({ verified: true, alreadyConfirmed: true });
            if (!data.accepted) {
              return json(
                {
                  error: "A code was sent recently. Please wait before requesting another.",
                  retryAfterSeconds: data.retry_after_seconds,
                },
                429,
              );
            }

            try {
              const { sendLovableEmail } = await import("@lovable.dev/email-js");
              await sendLovableEmail(
                {
                  to: user.email,
                  from: FROM,
                  sender_domain: SENDER_DOMAIN,
                  subject: "Your Access verification code",
                  html: emailHtml(code),
                  text: emailText(code),
                  purpose: "transactional",
                  idempotency_key: `passenger-email-confirm-${challengeId}`,
                },
                { apiKey },
              );
            } catch (sendError) {
              await rpc<void>("service_abort_passenger_email_challenge", {
                p_user_id: user.id,
                p_challenge_id: challengeId,
              });
              throw sendError;
            }

            return json({ sent: true, expiresInMinutes: CODE_TTL_MINUTES });
          }

          if (action === "verify") {
            const code = String(body.code ?? "").replace(/\s/g, "");
            if (!/^\d{6}$/.test(code)) return json({ error: "Enter the 6-digit code" }, 400);
            const codeHash = await hmacCode(apiKey, user.id, user.email, code);
            const { data, error } = await rpc<VerifyResult>("service_verify_passenger_email_challenge", {
              p_user_id: user.id,
              p_email: user.email,
              p_code_hash: codeHash,
            });
            if (error) throw new Error(error.message);
            if (!data) throw new Error("Could not verify the email confirmation code");
            if (!data.verified) {
              const messages: Record<VerifyResult["reason"], string> = {
                confirmed: "Email confirmed",
                already_confirmed: "Email already confirmed",
                no_challenge: "Request a new verification code",
                expired: "This code has expired. Request a new one.",
                too_many_attempts: "Too many attempts. Request a new code.",
                invalid_code: "That code is not correct",
              };
              return json(
                {
                  error: messages[data.reason],
                  reason: data.reason,
                  attemptsRemaining: data.attempts_remaining,
                },
                400,
              );
            }
            return json({ verified: true });
          }

          return json({ error: "Unsupported email confirmation action" }, 400);
        } catch (error) {
          console.error("[passenger-email-confirmation]", error);
          return json(
            { error: error instanceof Error ? error.message : "Email confirmation failed" },
            500,
          );
        }
      },
    },
  },
});

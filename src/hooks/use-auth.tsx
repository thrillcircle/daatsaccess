import { useEffect, useState, useCallback } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "passenger" | "driver" | "admin";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return { session, user, loading, signOut };
}

export function useUserRoles(userId: string | undefined) {
  const [roles, setRoles] = useState<AppRole[] | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setRoles(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (error) {
      console.error(error);
      setRoles([]);
    } else {
      setRoles((data ?? []).map((r) => r.role as AppRole));
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { roles, loading, refresh };
}

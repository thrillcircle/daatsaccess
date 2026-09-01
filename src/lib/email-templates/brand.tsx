import * as React from 'react'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

export const BRAND_BLUE = '#0067D1'
export const SITE_URL = 'https://daats.app'
export const LOGO_URL = `${SITE_URL}/access-logo.png`

interface EmailShellProps {
  preview: string
  heading: string
  children: React.ReactNode
  /** Extra reassurance line shown above the standard footer. */
  note?: string
}

/**
 * Shared premium branded shell for every Access auth email.
 * Table-safe, inline-styled and mobile friendly.
 */
export const EmailShell = ({
  preview,
  heading,
  children,
  note,
}: EmailShellProps) => (
  <Html lang="en" dir="ltr">
    <Head>
      <meta name="color-scheme" content="light" />
      <meta name="supported-color-schemes" content="light" />
      <style>{sharedCss}</style>
    </Head>
    <Preview>{preview}</Preview>
    <Body style={main}>
      <Container className="dm-outer" style={outer}>
        <Section className="dm-card" style={card}>
          <Section style={accent} />
          <Section style={cardInner}>
            <table
              role="presentation"
              cellPadding={0}
              cellSpacing={0}
              style={brandTable}
            >
              <tbody>
                <tr>
                  <td style={brandLogoCell}>
                    <Img
                      src={LOGO_URL}
                      alt="Access by DAATS"
                      width="40"
                      height="40"
                      style={logo}
                    />
                  </td>
                  <td style={brandTextCell}>
                    <Text className="dm-wordmark" style={wordmark}>
                      Access
                    </Text>
                    <Text className="dm-endorse" style={endorsement}>
                      by DAATS
                    </Text>
                  </td>
                </tr>
              </tbody>
            </table>

            <Heading className="dm-h1" style={h1}>
              {heading}
            </Heading>
            {children}
          </Section>
        </Section>
        {note ? (
          <Text className="dm-muted" style={footerNote}>
            {note}
          </Text>
        ) : null}
        <Text className="dm-muted" style={footer}>
          Access by DAATS
          <br />
          <Link href={SITE_URL} className="dm-link" style={footerLink}>
            daats.app
          </Link>
          <br />
          This is an automated security email. Please do not reply.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const CtaButton = ({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) => (
  <table role="presentation" cellPadding={0} cellSpacing={0} style={btnTable}>
    <tbody>
      <tr>
        <td className="dm-btn" style={btnCell}>
          <a href={href} className="dm-btn-link" style={btnLink}>
            {children}
          </a>
        </td>
      </tr>
    </tbody>
  </table>
)

export const main = {
  backgroundColor: '#F5F7FB',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  margin: '0',
  padding: '0',
}
const outer = { width: '100%', maxWidth: '600px', padding: '32px 16px' }
const card = {
  backgroundColor: '#ffffff',
  borderRadius: '14px',
  border: '1px solid #E3E9F2',
  overflow: 'hidden' as const,
}
const accent = {
  backgroundColor: BRAND_BLUE,
  height: '5px',
  lineHeight: '5px',
  fontSize: '1px',
}
const cardInner = { padding: '36px 32px 40px' }
const brandTable = { margin: '0 0 28px', borderCollapse: 'collapse' as const }
const brandLogoCell = { verticalAlign: 'middle' as const, paddingRight: '10px' }
const brandTextCell = { verticalAlign: 'middle' as const }
const logo = {
  display: 'block' as const,
  width: '40px',
  height: '40px',
  borderRadius: '12px',
  margin: '0',
}
const wordmark = {
  fontSize: '20px',
  lineHeight: '1.15',
  fontWeight: 600,
  letterSpacing: '0',
  color: BRAND_BLUE,
  margin: '0',
}
const endorsement = {
  fontSize: '12px',
  lineHeight: '1.2',
  letterSpacing: '0',
  color: '#7A869A',
  margin: '2px 0 0',
}

const h1 = {
  fontSize: '22px',
  lineHeight: '1.3',
  fontWeight: 'bold' as const,
  color: '#0F1B2D',
  margin: '0 0 16px',
}
export const text = {
  fontSize: '15px',
  lineHeight: '1.6',
  color: '#43506B',
  margin: '0 0 20px',
}
export const link = { color: BRAND_BLUE, textDecoration: 'underline' }
export const code = {
  display: 'block' as const,
  backgroundColor: '#F1F5FC',
  border: `1px solid #D6E3F7`,
  borderRadius: '10px',
  fontFamily: "'Courier New', Courier, monospace",
  fontSize: '32px',
  letterSpacing: '8px',
  fontWeight: 'bold' as const,
  textAlign: 'center' as const,
  color: '#0F1B2D',
  padding: '18px 12px',
  margin: '0 0 24px',
}
const btnTable = { margin: '0 0 8px' }
const btnCell = {
  backgroundColor: BRAND_BLUE,
  borderRadius: '10px',
}
const btnLink = {
  display: 'inline-block' as const,
  padding: '14px 26px',
  fontSize: '15px',
  fontWeight: 'bold' as const,
  color: '#ffffff',
  textDecoration: 'none',
}
const footerNote = {
  fontSize: '13px',
  lineHeight: '1.6',
  color: '#7A869A',
  margin: '24px 4px 0',
}
const footer = {
  fontSize: '12px',
  lineHeight: '1.7',
  color: '#8A94A6',
  margin: '20px 4px 0',
}
const footerLink = { color: BRAND_BLUE, textDecoration: 'underline' }

// Rendered as a text child, which React may HTML-escape: keep this CSS free of >, &, and quotes.
const sharedCss = `
  @media only screen and (max-width: 480px) {
    .dm-outer { padding: 16px 10px !important; }
    .dm-h1 { font-size: 20px !important; }
  }
  @media (prefers-color-scheme: dark) {
    body { background-color: #10151F !important; }
    .dm-card { background-color: #FFFFFF !important; }
    .dm-muted { color: #A9B2C3 !important; }
  }
`

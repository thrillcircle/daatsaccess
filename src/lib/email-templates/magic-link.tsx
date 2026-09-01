import * as React from 'react'

import { Text } from '@react-email/components'
import { CtaButton, EmailShell, text } from './brand'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <EmailShell
    preview={`Your ${siteName} sign-in link`}
    heading="Your sign-in link"
    note="If you did not request this link, you can safely ignore this email."
  >
    <Text style={text}>
      Use the secure link below to sign in to {siteName}. For your protection it
      expires shortly and can only be used once.
    </Text>
    <CtaButton href={confirmationUrl}>Sign in to {siteName}</CtaButton>
  </EmailShell>
)

export default MagicLinkEmail

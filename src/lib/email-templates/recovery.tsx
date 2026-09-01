import * as React from 'react'

import { Text } from '@react-email/components'
import { CtaButton, EmailShell, text } from './brand'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <EmailShell
    preview={`Reset your ${siteName} password`}
    heading="Reset your password"
    note="If you did not request a password reset, you can safely ignore this email — your password will not change."
  >
    <Text style={text}>
      We received a request to reset the password for your {siteName} account.
      Choose a new password using the secure link below.
    </Text>
    <CtaButton href={confirmationUrl}>Reset password</CtaButton>
  </EmailShell>
)

export default RecoveryEmail

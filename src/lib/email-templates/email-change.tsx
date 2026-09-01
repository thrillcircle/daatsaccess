import * as React from 'react'

import { Text } from '@react-email/components'
import { CtaButton, EmailShell, link, text } from './brand'

interface EmailChangeEmailProps {
  siteName: string
  // oldEmail is the user's current address (HookData.OldEmail). For the
  // NEW-recipient half of a secure email_change fanout, `email` equals the
  // recipient (NEW), so the "from" line must render oldEmail to read
  // "from OLD to NEW" instead of "from NEW to NEW".
  oldEmail: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  siteName,
  oldEmail,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <EmailShell
    preview={`Confirm your new ${siteName} email`}
    heading="Confirm your new email"
    note="If you did not request this change, please secure your account immediately."
  >
    <Text style={text}>
      You asked to change the email address on your {siteName} account from{' '}
      <a href={`mailto:${oldEmail}`} style={link}>
        {oldEmail}
      </a>{' '}
      to{' '}
      <a href={`mailto:${newEmail}`} style={link}>
        {newEmail}
      </a>
      .
    </Text>
    <CtaButton href={confirmationUrl}>Confirm email change</CtaButton>
  </EmailShell>
)

export default EmailChangeEmail

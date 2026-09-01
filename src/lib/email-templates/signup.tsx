import * as React from 'react'

import { Text } from '@react-email/components'
import { CtaButton, EmailShell, link, text } from './brand'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <EmailShell
    preview={`Confirm your ${siteName} email`}
    heading="Confirm your email"
    note={`If you did not create an ${siteName} account, you can safely ignore this email.`}
  >
    <Text style={text}>
      Welcome to {siteName}. Please confirm{' '}
      <a href={`mailto:${recipient}`} style={link}>
        {recipient}
      </a>{' '}
      to activate your account.
    </Text>
    <CtaButton href={confirmationUrl}>Confirm email</CtaButton>
  </EmailShell>
)

export default SignupEmail

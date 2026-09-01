import * as React from 'react'

import { Text } from '@react-email/components'
import { CtaButton, EmailShell, text } from './brand'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({
  siteName,
  confirmationUrl,
}: InviteEmailProps) => (
  <EmailShell
    preview={`You are invited to ${siteName}`}
    heading={`You're invited to ${siteName}`}
    note="If you were not expecting this invitation, you can safely ignore this email."
  >
    <Text style={text}>
      You have been invited to join {siteName}. Accept the invitation below to
      set up your account and get started.
    </Text>
    <CtaButton href={confirmationUrl}>Accept invitation</CtaButton>
  </EmailShell>
)

export default InviteEmail

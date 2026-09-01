import * as React from 'react'

import { Text } from '@react-email/components'
import { EmailShell, code, text } from './brand'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <EmailShell
    preview="Your Access verification code"
    heading="Your verification code"
    note="If you did not request this code, you can safely ignore this email."
  >
    <Text style={text}>
      Enter the code below to confirm your identity. It expires shortly.
    </Text>
    <Text style={code}>{token}</Text>
  </EmailShell>
)

export default ReauthenticationEmail

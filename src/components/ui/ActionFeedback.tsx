export type ActionFeedbackMessage = {
  kind: 'success' | 'error'
  text: string
}

export function ActionFeedback({ message, className = '' }: { message: ActionFeedbackMessage | null; className?: string }) {
  if (!message) return null

  return (
    <div className={`action-feedback admin-action-feedback ${message.kind} ${className}`.trim()} role={message.kind === 'error' ? 'alert' : 'status'}>
      {message.text}
    </div>
  )
}

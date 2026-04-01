type Props = { status: string; disabled: boolean; onClick: () => void }

const LABELS: Record<string, string> = {
  idle: 'Execute',
  building: 'Building batch...',
  quoting: 'Getting quote...',
  signing: 'Sign in wallet...',
  executing: 'Executing...',
  success: 'Execute Again',
  error: 'Retry',
}

export function ExecuteButton({ status, disabled, onClick }: Props) {
  const isWorking = ['building', 'quoting', 'signing', 'executing'].includes(status)

  return (
    <button
      onClick={onClick}
      disabled={disabled || isWorking}
      className={`w-full py-3 rounded-lg font-medium transition ${
        status === 'error'
          ? 'bg-danger/10 text-danger border border-danger/20 hover:bg-danger/15'
          : 'bg-accent text-white hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed'
      }`}
    >
      {isWorking && (
        <span className="inline-block w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin mr-2 align-middle" />
      )}
      {LABELS[status] ?? 'Execute'}
    </button>
  )
}

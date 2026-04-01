type Props = {
  status: string
  hash?: string
  txHash?: string
  explorerUrl?: string
  error?: string
  successLabel?: string
}

export function TxStatus({ status, txHash, explorerUrl, error, successLabel = 'Position created' }: Props) {
  if (status !== 'success' && status !== 'error') return null

  return (
    <div className="border border-border-dim rounded-lg p-3 space-y-1.5">
      {status === 'success' && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-success">{successLabel}</span>
          {txHash && explorerUrl && (
            <a
              href={`${explorerUrl}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent hover:underline"
            >
              View on explorer &#8599;
            </a>
          )}
        </div>
      )}
      {status === 'error' && (
        <p className="text-sm text-danger">{error ?? 'Transaction failed'}</p>
      )}
    </div>
  )
}

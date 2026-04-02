import { leverageAfterLoops, loopsForLeverage, MIN_LEVERAGE, MAX_LEVERAGE } from '../lib/leverage-math'

type Props = {
  leverage: number
  loops: number
  onLeverageChange: (leverage: number, loops: number) => void
  disabled: boolean
}

export function LeverageForm({ leverage, loops, onLeverageChange, disabled }: Props) {
  function handleChange(value: number) {
    const l = loopsForLeverage(value)
    onLeverageChange(leverageAfterLoops(l), l)
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-sm text-text-secondary">Leverage</span>
        <div className="text-right">
          <span className="text-2xl font-mono font-semibold tabular-nums">{leverage.toFixed(1)}x</span>
          <span className="text-xs text-text-tertiary ml-2">{loops} loop{loops !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <input
        type="range"
        min={MIN_LEVERAGE}
        max={MAX_LEVERAGE}
        step={0.1}
        value={leverage}
        onChange={e => handleChange(parseFloat(e.target.value))}
        disabled={disabled}
        className="w-full h-1 bg-border-dim rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent
          [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-0"
      />

      <div className="flex justify-between mt-1.5 text-[11px] text-text-tertiary">
        <span>1.5x</span>
        <span>4.0x</span>
      </div>
    </div>
  )
}

'use client';

export function ViewModeToggle<M extends string = 'list' | 'calendar'>({
  mode,
  onChange,
  modes = ['list', 'calendar'] as unknown as readonly M[],
}: {
  mode: M;
  onChange: (mode: M) => void;
  modes?: readonly M[];
}) {
  return (
    <div className="flex gap-2">
      {modes.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`rounded-full border px-3 py-1 text-xs capitalize ${
            mode === id
              ? 'border-good bg-good/10 text-good'
              : 'border-edge bg-canvas text-ink-mid hover:bg-panel-hover'
          }`}
        >
          {id}
        </button>
      ))}
    </div>
  );
}

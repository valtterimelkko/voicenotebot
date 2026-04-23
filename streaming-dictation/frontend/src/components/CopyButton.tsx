import { useState } from 'react'

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Fallback for browsers without clipboard API
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
        copied
          ? 'bg-green-100 text-green-700 border-green-300'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200 active:bg-slate-300'
      }`}
      aria-label={copied ? 'Copied to clipboard' : 'Copy transcript'}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

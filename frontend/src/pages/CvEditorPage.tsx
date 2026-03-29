import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useCandidate } from '../context/CandidateContext';
import { improveCvText, updateCandidate, generateCvMarkdown } from '../lib/api';
import Icon from '../components/shared/Icon';

// --- Markdown CV Generator ---

// Basic fallback CV template (used while AI generates the full version)
function fallbackMarkdownCV(name: string): string {
  return `# ${name}\n\nLoading your CV from AI...\n\nPlease wait while we generate a complete CV from your profile data.`;
}

// --- Markdown → HTML ---

function renderMarkdownToHtml(md: string): string {
  let html = md
    .replace(/^### (.+)$/gm, '<h3 style="font-size:16px;font-weight:700;color:#050728;margin:20px 0 4px">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:18px;font-weight:800;color:#050728;margin:28px 0 10px;padding-bottom:6px;border-bottom:2px solid #e7e6ff">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:26px;font-weight:800;color:#050728;margin:0 0 6px">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em style="color:#46464e">$1</em>')
    .replace(/^- (.+)$/gm, '<li style="margin-left:16px;font-size:14px;line-height:1.7">$1</li>')
    .replace(/ · /g, ' <span style="color:#77767e">·</span> ')
    .replace(/\n\n/g, '</p><p style="font-size:14px;line-height:1.7;margin-bottom:6px">')
    .replace(/\n(?!<)/g, '\n');
  html = html.replace(/((<li[^>]*>.*?<\/li>\n?)+)/g, '<ul style="margin:4px 0 12px;padding-left:4px;list-style:none">$1</ul>');
  return `<div style="font-family:Inter,system-ui,sans-serif;color:#161838"><p style="font-size:14px;line-height:1.7;margin-bottom:6px">${html}</p></div>`;
}

// --- AI Floating Toolbar ---

interface AiToolbarProps {
  position: { x: number; y: number };
  selectedText: string;
  fullMarkdown: string;
  onApply: (newText: string) => void;
  onClose: () => void;
}

function AiToolbar({ position, selectedText, fullMarkdown, onApply, onClose }: AiToolbarProps) {
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const runAction = async (action: 'improve' | 'shorten' | 'expand' | 'quantify') => {
    setLoading(true); setError(null); setSuggestion(null);
    try {
      const res = await improveCvText(selectedText, fullMarkdown.slice(0, 500), action);
      setSuggestion(res.improved_text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI request failed');
    } finally { setLoading(false); }
  };

  const actions = [
    { key: 'improve' as const, icon: 'auto_fix_high', label: 'Improve' },
    { key: 'shorten' as const, icon: 'compress', label: 'Shorten' },
    { key: 'expand' as const, icon: 'expand', label: 'Expand' },
    { key: 'quantify' as const, icon: 'bar_chart', label: 'Quantify' },
  ];

  return (
    <div ref={ref} className="fixed z-[100] animate-fade-in" style={{ left: position.x, top: position.y }}>
      <div className="bg-primary-container rounded-2xl shadow-xl overflow-hidden w-80">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Icon name="smart_toy" size="sm" className="text-tertiary-fixed" />
            <span className="text-xs font-bold text-on-primary uppercase tracking-wider">AI Assistant</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 transition-colors">
            <Icon name="close" size="sm" className="text-on-primary-container" />
          </button>
        </div>

        {/* Selected text preview */}
        <div className="px-4 pb-3">
          <p className="text-[11px] text-on-primary-container/70 truncate italic">
            "{selectedText.slice(0, 80)}{selectedText.length > 80 ? '...' : ''}"
          </p>
        </div>

        {/* Action buttons */}
        {!suggestion && !loading && (
          <div className="grid grid-cols-4 gap-1 px-3 pb-3">
            {actions.map(a => (
              <button key={a.key} onClick={() => runAction(a.key)}
                className="flex flex-col items-center gap-1 py-2 px-1 rounded-xl hover:bg-white/10 transition-colors"
              >
                <Icon name={a.icon} size="sm" className="text-tertiary-fixed" />
                <span className="text-[10px] font-bold text-on-primary-container">{a.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center gap-2 px-4 py-4">
            <span className="animate-spin"><Icon name="progress_activity" size="sm" className="text-tertiary-fixed" /></span>
            <span className="text-xs text-on-primary-container font-medium">Thinking...</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-4 pb-3">
            <p className="text-xs text-error bg-error-container rounded-lg px-3 py-2">{error}</p>
          </div>
        )}

        {/* Suggestion result */}
        {suggestion && (
          <div className="bg-surface-container-lowest rounded-t-xl">
            <div className="px-4 py-3 max-h-48 overflow-auto">
              <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Suggestion</p>
              <p className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap">{suggestion}</p>
            </div>
            <div className="flex gap-2 p-3 border-t border-surface-container-high">
              <button onClick={() => { onApply(suggestion); onClose(); }}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-primary text-on-primary py-2.5 text-xs font-bold hover:opacity-90 transition-opacity"
              >
                <Icon name="check" size="sm" /> Accept
              </button>
              <button onClick={() => setSuggestion(null)}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-surface-container-high text-on-surface py-2.5 text-xs font-bold hover:bg-surface-container-highest transition-colors"
              >
                <Icon name="replay" size="sm" /> Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Main Page ---

export default function CvEditorPage() {
  const { candidate, setCandidate } = useCandidate();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const [markdown, setMarkdown] = useState('');
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ name: string; skills: number } | null>(null);
  const [generating, setGenerating] = useState(false);

  // Generate CV markdown from AI on mount
  useEffect(() => {
    if (!candidate) {
      setMarkdown('# Your Name\n\nUpload a resume first to generate your CV.');
      return;
    }
    // Only generate if markdown is empty (first load)
    if (markdown) return;

    setGenerating(true);
    setMarkdown(fallbackMarkdownCV(candidate.name));

    generateCvMarkdown(candidate.candidate_id)
      .then(res => setMarkdown(res.markdown))
      .catch(() => {
        // Fallback: basic template
        const lines = [`# ${candidate.name}`, ''];
        if (candidate.email) lines.push(`**Email:** ${candidate.email}  `);
        if (candidate.summary) lines.push('', '## Summary', '', candidate.summary);
        if (candidate.skills.length > 0) lines.push('', '## Skills', '', candidate.skills.join(' · '));
        setMarkdown(lines.join('\n'));
      })
      .finally(() => setGenerating(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.candidate_id]);

  // AI toolbar state
  const [aiToolbar, setAiToolbar] = useState<{
    position: { x: number; y: number };
    selectedText: string;
    selectionStart: number;
    selectionEnd: number;
  } | null>(null);

  const renderedHtml = useMemo(() => renderMarkdownToHtml(markdown), [markdown]);

  // Detect text selection in editor
  const handleMouseUp = useCallback(() => {
    const textarea = editorRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end).trim();

    if (selected.length < 5) { setAiToolbar(null); return; }

    // Get position of cursor
    const rect = textarea.getBoundingClientRect();
    // Approximate position near the selection
    const lines = textarea.value.substring(0, start).split('\n');
    const lineHeight = 22;
    const scrollTop = textarea.scrollTop;
    const approxY = rect.top + (lines.length * lineHeight) - scrollTop;
    const approxX = Math.min(rect.left + 20, window.innerWidth - 340);

    setAiToolbar({
      position: { x: Math.max(10, approxX), y: Math.min(approxY, window.innerHeight - 300) },
      selectedText: selected,
      selectionStart: start,
      selectionEnd: end,
    });
  }, []);

  // Apply AI suggestion by replacing selected text in markdown
  const handleApplySuggestion = useCallback((newText: string) => {
    if (!aiToolbar) return;
    const before = markdown.substring(0, aiToolbar.selectionStart);
    const after = markdown.substring(aiToolbar.selectionEnd);
    setMarkdown(before + newText + after);
  }, [aiToolbar, markdown]);

  // Download as .md
  const handleDownloadMd = () => {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${candidate?.name?.replace(/\s+/g, '_') || 'cv'}.md`;
    a.click(); URL.revokeObjectURL(url);
  };

  // Download as PDF via print
  const handleDownloadPdf = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <!DOCTYPE html>
      <html><head>
        <title>${candidate?.name || 'CV'} - Resume</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Inter', system-ui, sans-serif; color: #161838; padding: 40px 50px; max-width: 800px; margin: 0 auto; }
          h1 { font-size: 26px; font-weight: 800; margin-bottom: 6px; }
          h2 { font-size: 16px; font-weight: 800; margin-top: 24px; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 2px solid #e7e6ff; }
          h3 { font-size: 14px; font-weight: 700; margin-top: 16px; margin-bottom: 2px; }
          p, li { font-size: 12px; line-height: 1.7; }
          ul { list-style: none; padding-left: 0; margin: 4px 0 10px; }
          li { margin-left: 12px; }
          li:before { content: "•"; margin-right: 8px; color: #77767e; }
          strong { font-weight: 700; }
          em { color: #46464e; }
          @media print { body { padding: 20px 30px; } }
        </style>
      </head><body>${renderedHtml}</body></html>
    `);
    printWindow.document.close();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
  };

  // Save — re-parse markdown as resume and update profile
  const handleSave = async () => {
    if (!candidate) return;
    setSaving(true); setSaveResult(null);
    try {
      const updated = await updateCandidate(candidate.candidate_id, markdown);
      setCandidate(updated);
      setSaveResult({ name: updated.name, skills: updated.skills.length });
      setTimeout(() => setSaveResult(null), 5000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save profile.');
    } finally { setSaving(false); }
  };

  // Copy markdown
  const handleCopy = async () => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative">
      {/* Saving overlay */}
      {saving && (
        <div className="fixed inset-0 z-50 bg-surface/60 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-surface-container-lowest rounded-2xl p-8 shadow-xl text-center max-w-sm mx-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-primary text-3xl animate-spin">progress_activity</span>
            </div>
            <h3 className="text-lg font-extrabold text-on-surface mb-2">Updating Your Profile</h3>
            <p className="text-sm text-on-surface-variant">AI is re-analyzing your CV to extract skills, experience, and seniority. This will update your profile across all future matches.</p>
          </div>
        </div>
      )}

      {/* Success notification */}
      {saveResult && (
        <div className="mb-4 flex items-center gap-3 rounded-xl bg-tertiary-fixed/15 px-5 py-3 animate-fade-in">
          <Icon name="check_circle" size="md" className="text-on-tertiary-container" />
          <div>
            <p className="text-sm font-bold text-on-tertiary-container">Profile updated successfully</p>
            <p className="text-xs text-on-surface-variant">{saveResult.name} — {saveResult.skills} skills extracted. All future job matches will use your updated profile.</p>
          </div>
        </div>
      )}

      {/* Back nav */}
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-bold text-on-surface-variant hover:text-secondary transition-colors mb-6">
        <Icon name="arrow_back" size="sm" />
        Back to Dashboard
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-primary tracking-tight">CV Editor</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Edit in Markdown, preview live. <span className="text-secondary font-semibold">Select text to get AI suggestions.</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleSave} disabled={saving || generating}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              saveResult ? 'bg-tertiary-fixed text-on-tertiary-fixed' : 'bg-primary text-on-primary hover:opacity-90'
            } disabled:opacity-50`}>
            <Icon name={saveResult ? 'check' : saving ? 'progress_activity' : 'save'} size="sm" className={saving ? 'animate-spin' : ''} />
            {saveResult ? 'Profile Updated!' : saving ? 'Saving...' : 'Save Profile'}
          </button>
          <button onClick={() => {
              if (!candidate) return;
              setGenerating(true);
              generateCvMarkdown(candidate.candidate_id)
                .then(res => setMarkdown(res.markdown))
                .catch(() => {})
                .finally(() => setGenerating(false));
            }} disabled={generating}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container-high text-on-surface text-xs font-bold hover:bg-surface-container-highest transition-colors disabled:opacity-50">
            <Icon name={generating ? 'progress_activity' : 'refresh'} size="sm" className={generating ? 'animate-spin' : ''} />
            {generating ? 'Generating...' : 'Regenerate'}
          </button>
          <button onClick={handleCopy}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container-high text-on-surface text-xs font-bold hover:bg-surface-container-highest transition-colors">
            <Icon name={copied ? 'check' : 'content_copy'} size="sm" />
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={handleDownloadMd}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container-high text-on-surface text-xs font-bold hover:bg-surface-container-highest transition-colors">
            <Icon name="description" size="sm" />
            .md
          </button>
          <button onClick={handleDownloadPdf}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-primary to-secondary text-on-primary text-xs font-bold hover:opacity-90 transition-opacity">
            <Icon name="picture_as_pdf" size="sm" />
            PDF
          </button>
        </div>
      </div>

      {/* Mobile tab toggle */}
      <div className="flex gap-2 mb-4 lg:hidden">
        {(['edit', 'preview'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
              activeTab === tab ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
            }`}
          >
            {tab === 'edit' ? 'Editor' : 'Preview'}
          </button>
        ))}
      </div>

      {/* Split editor + preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Editor */}
        <div className={`${activeTab === 'preview' ? 'hidden lg:block' : ''}`}>
          <div className="bg-surface-container-lowest rounded-2xl overflow-hidden h-[calc(100vh-260px)]">
            <div className="flex items-center justify-between px-4 py-3 bg-surface-container-low">
              <div className="flex items-center gap-2">
                <Icon name="edit_note" size="sm" className="text-primary" />
                <span className="text-xs font-bold text-on-surface uppercase tracking-wider">Markdown</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-secondary font-semibold bg-secondary-fixed px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Icon name="smart_toy" size="sm" />
                  Select text for AI
                </span>
                <span className="text-xs text-on-surface-variant font-mono">{markdown.split('\n').length} lines</span>
              </div>
            </div>
            <textarea
              ref={editorRef}
              value={markdown}
              onChange={e => setMarkdown(e.target.value)}
              onMouseUp={handleMouseUp}
              onKeyUp={handleMouseUp}
              spellCheck={false}
              className="w-full h-[calc(100%-44px)] p-6 text-sm font-mono text-on-surface bg-surface-container-lowest resize-none focus:outline-none leading-relaxed"
            />
          </div>
        </div>

        {/* Preview */}
        <div className={`${activeTab === 'edit' ? 'hidden lg:block' : ''}`}>
          <div className="bg-surface-container-lowest rounded-2xl overflow-hidden h-[calc(100vh-260px)]">
            <div className="flex items-center justify-between px-4 py-3 bg-surface-container-low">
              <div className="flex items-center gap-2">
                <Icon name="preview" size="sm" className="text-secondary" />
                <span className="text-xs font-bold text-on-surface uppercase tracking-wider">Preview</span>
              </div>
            </div>
            <div ref={previewRef} className="p-8 h-[calc(100%-44px)] overflow-auto"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          </div>
        </div>
      </div>

      {/* Tips */}
      <div className="mt-4 p-4 bg-tertiary-fixed/10 border-l-4 border-tertiary-fixed-dim rounded-r-xl">
        <div className="flex gap-3">
          <Icon name="lightbulb" className="text-on-tertiary-container shrink-0" />
          <p className="text-sm text-on-surface-variant">
            <span className="font-bold text-on-tertiary-container">Pro tip:</span> Select any text in the editor to get AI-powered suggestions.
            Choose <strong>Improve</strong> for better wording, <strong>Quantify</strong> to add metrics,
            <strong> Shorten</strong> to be concise, or <strong>Expand</strong> for more detail.
          </p>
        </div>
      </div>

      {/* AI Floating Toolbar */}
      {aiToolbar && (
        <AiToolbar
          position={aiToolbar.position}
          selectedText={aiToolbar.selectedText}
          fullMarkdown={markdown}
          onApply={handleApplySuggestion}
          onClose={() => setAiToolbar(null)}
        />
      )}
    </div>
  );
}

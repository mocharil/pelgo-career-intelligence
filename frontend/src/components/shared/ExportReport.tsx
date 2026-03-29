import type { CandidateResponse, MatchJob } from '../../lib/api';
import Icon from './Icon';

function extractJobTitle(reasoning: string): string {
  const match = reasoning.match(/(?:role|position|job)[:\s]+["']?([^"'\n.]+)/i);
  return match ? match[1].trim() : 'Job Analysis';
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function buildReportHTML(candidate: CandidateResponse, match: MatchJob, coverLetter?: string): string {
  const result = match.result;
  if (!result) return '<p>No analysis data available.</p>';

  const title = extractJobTitle(result.reasoning);
  const date = formatDate();

  const scoreColor = (s: number) => (s > 70 ? '#2e7d32' : s >= 50 ? '#ed6c02' : '#d32f2f');

  const matchedSkillsHTML = result.matched_skills.length > 0
    ? result.matched_skills.map((s) => `<span style="display:inline-block;background:#e8f5e9;color:#2e7d32;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600;margin:2px;">${s}</span>`).join('')
    : '<span style="color:#888;font-size:13px;">None identified</span>';

  const gapSkillsHTML = result.gap_skills.length > 0
    ? result.gap_skills.map((s) => `<span style="display:inline-block;background:#fbe9e7;color:#d32f2f;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600;margin:2px;">${s}</span>`).join('')
    : '<span style="color:#888;font-size:13px;">None identified</span>';

  const experiencesHTML = candidate.experiences.map((exp) => `
    <div style="margin-bottom:12px;">
      <div style="font-weight:700;font-size:14px;color:#1a1a2e;">${exp.title}</div>
      <div style="font-size:13px;color:#555;">${exp.company} &middot; ${exp.duration_years} year${exp.duration_years !== 1 ? 's' : ''}</div>
      <div style="font-size:12px;color:#777;margin-top:4px;">${exp.description}</div>
    </div>
  `).join('');

  const educationHTML = candidate.education.map((edu) => `
    <div style="margin-bottom:8px;">
      <div style="font-weight:700;font-size:14px;color:#1a1a2e;">${edu.degree} in ${edu.field_of_study}</div>
      <div style="font-size:13px;color:#555;">${edu.institution}${edu.year ? ` (${edu.year})` : ''}</div>
    </div>
  `).join('');

  const learningHTML = result.learning_plan.map((entry) => {
    const totalHrs = entry.resources.reduce((s, r) => s + r.estimated_hours, 0);
    const resourceRows = entry.resources.map((r) => `
      <tr>
        <td style="padding:6px 12px;font-size:12px;border-bottom:1px solid #eee;">${r.title}</td>
        <td style="padding:6px 12px;font-size:12px;border-bottom:1px solid #eee;text-transform:capitalize;">${r.type}</td>
        <td style="padding:6px 12px;font-size:12px;border-bottom:1px solid #eee;text-align:right;">${r.estimated_hours}h</td>
      </tr>
    `).join('');
    return `
      <div style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-weight:700;font-size:14px;color:#1a1a2e;">${entry.skill}</span>
          <span style="font-size:12px;color:#555;">Priority #${entry.priority_rank} &middot; +${entry.estimated_match_gain_pct}% match gain &middot; ${totalHrs}h total</span>
        </div>
        <div style="font-size:12px;color:#777;margin-bottom:8px;">${entry.rationale}</div>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:#f5f5f5;">
            <th style="padding:6px 12px;text-align:left;font-size:11px;font-weight:700;color:#555;text-transform:uppercase;">Resource</th>
            <th style="padding:6px 12px;text-align:left;font-size:11px;font-weight:700;color:#555;text-transform:uppercase;">Type</th>
            <th style="padding:6px 12px;text-align:right;font-size:11px;font-weight:700;color:#555;text-transform:uppercase;">Hours</th>
          </tr></thead>
          <tbody>${resourceRows}</tbody>
        </table>
      </div>
    `;
  }).join('');

  const dimBar = (label: string, value: number) => `
    <div style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
        <span style="color:#555;">${label}</span>
        <span style="font-weight:700;color:#1a1a2e;">${value}%</span>
      </div>
      <div style="height:8px;background:#e0e0e0;border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${value}%;background:${scoreColor(value)};border-radius:4px;"></div>
      </div>
    </div>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Pelgo Career Intelligence Report - ${candidate.name}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; color: #1a1a2e; line-height: 1.6; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page-break { page-break-before: always; }
      #action-bar { display: none !important; }
      #action-bar + div { display: none !important; }
    }
    @page { margin: 20mm 18mm; size: A4; }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="border-bottom:3px solid #1a1a2e;padding-bottom:16px;margin-bottom:32px;display:flex;justify-content:space-between;align-items:flex-end;">
    <div>
      <div style="font-size:22px;font-weight:800;color:#1a1a2e;letter-spacing:-0.5px;">Pelgo</div>
      <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:2px;margin-top:2px;">Career Intelligence Report</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:12px;color:#555;">${date}</div>
      <div style="font-size:11px;color:#888;">Confidential</div>
    </div>
  </div>

  <!-- Section 1: Candidate Profile -->
  <div style="margin-bottom:32px;">
    <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px;">Section 1</div>
    <h2 style="font-size:20px;font-weight:800;color:#1a1a2e;margin-bottom:16px;">Candidate Profile</h2>

    <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin-bottom:16px;">
      <div style="font-size:22px;font-weight:800;color:#1a1a2e;">${candidate.name}</div>
      <div style="font-size:13px;color:#555;margin-top:2px;">${candidate.email} &middot; ${candidate.seniority_level} &middot; ${candidate.total_years_experience} years experience</div>
    </div>

    <div style="margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Summary</div>
      <p style="font-size:13px;color:#333;line-height:1.7;">${candidate.summary}</p>
    </div>

    <div style="margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Core Skills</div>
      <div>${candidate.skills.map((s) => `<span style="display:inline-block;background:#e3f2fd;color:#1565c0;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600;margin:2px;">${s}</span>`).join('')}</div>
    </div>

    <div style="margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Experience</div>
      ${experiencesHTML}
    </div>

    <div>
      <div style="font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Education</div>
      ${educationHTML}
    </div>
  </div>

  <!-- Section 2: Match Analysis -->
  <div class="page-break" style="margin-bottom:32px;">
    <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px;">Section 2</div>
    <h2 style="font-size:20px;font-weight:800;color:#1a1a2e;margin-bottom:16px;">Match Analysis: ${title}</h2>

    <div style="display:flex;gap:24px;margin-bottom:24px;">
      <div style="text-align:center;background:#f8f9fa;border-radius:8px;padding:20px 32px;">
        <div style="font-size:42px;font-weight:800;color:${scoreColor(result.overall_score)};">${result.overall_score}%</div>
        <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;">Overall Match</div>
      </div>
      <div style="flex:1;padding:12px 0;">
        ${dimBar('Skills', result.dimension_scores.skills)}
        ${dimBar('Experience', result.dimension_scores.experience)}
        ${dimBar('Seniority Fit', result.dimension_scores.seniority_fit)}
      </div>
    </div>

    <div style="display:flex;gap:16px;margin-bottom:24px;">
      <div style="flex:1;">
        <div style="font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Matched Skills</div>
        <div>${matchedSkillsHTML}</div>
      </div>
      <div style="flex:1;">
        <div style="font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Gap Skills</div>
        <div>${gapSkillsHTML}</div>
      </div>
    </div>

    <div style="margin-bottom:24px;">
      <div style="font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Confidence</div>
      <span style="display:inline-block;background:${result.confidence === 'high' ? '#e8f5e9' : result.confidence === 'medium' ? '#fff3e0' : '#fbe9e7'};color:${result.confidence === 'high' ? '#2e7d32' : result.confidence === 'medium' ? '#ed6c02' : '#d32f2f'};padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;text-transform:uppercase;">${result.confidence}</span>
    </div>

    <div>
      <div style="font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">AI Analysis</div>
      <p style="font-size:13px;color:#333;line-height:1.7;">${result.reasoning}</p>
    </div>
  </div>

  <!-- Section 3: Learning Roadmap -->
  ${result.learning_plan.length > 0 ? `
  <div class="page-break" style="margin-bottom:32px;">
    <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px;">Section 3</div>
    <h2 style="font-size:20px;font-weight:800;color:#1a1a2e;margin-bottom:16px;">Learning Roadmap</h2>
    <p style="font-size:13px;color:#555;margin-bottom:20px;">
      Total estimated investment: <strong>${result.learning_plan.reduce((s, e) => s + e.resources.reduce((rs, r) => rs + r.estimated_hours, 0), 0)} hours</strong> across ${result.learning_plan.length} skill${result.learning_plan.length !== 1 ? 's' : ''}.
    </p>
    ${learningHTML}
  </div>
  ` : ''}

  <!-- Cover Letter -->
  ${coverLetter ? `
  <div class="page-break" style="margin-bottom:32px;">
    <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px;">Section 4</div>
    <h2 style="font-size:20px;font-weight:800;color:#1a1a2e;margin-bottom:16px;">Cover Letter</h2>
    <div style="font-size:13px;color:#333;line-height:1.8;white-space:pre-wrap;">${coverLetter}</div>
  </div>
  ` : ''}

  <!-- Footer -->
  <div style="border-top:1px solid #e0e0e0;padding-top:12px;display:flex;justify-content:space-between;" class="no-print-hide">
    <div style="font-size:11px;color:#aaa;">Generated by Pelgo AI</div>
    <div style="font-size:11px;color:#aaa;">${date}</div>
  </div>

  <!-- Action bar (hidden when printing) -->
  <div id="action-bar" style="position:fixed;top:0;left:0;right:0;background:#1a1a2e;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,0.15);">
    <div style="color:white;font-size:14px;font-weight:700;">Pelgo Report Preview</div>
    <div style="display:flex;gap:8px;">
      <button onclick="document.getElementById('action-bar').style.display='none';window.print();setTimeout(function(){document.getElementById('action-bar').style.display='flex';},500);" style="background:#6ffbbe;color:#002113;border:none;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">
        Save as PDF
      </button>
      <button onclick="window.close();" style="background:rgba(255,255,255,0.15);color:white;border:none;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">
        Close
      </button>
    </div>
  </div>
  <div style="height:56px;"></div>
</body>
</html>`;
}

export default function ExportReport({ candidate, match, coverLetter }: { candidate: CandidateResponse; match: MatchJob; coverLetter?: string }) {
  const handleExport = () => {
    const html = buildReportHTML(candidate, match, coverLetter);
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <button
      onClick={handleExport}
      disabled={!match.result}
      className="flex-1 flex items-center justify-center gap-2 px-8 py-4 bg-surface-container-high text-on-surface font-bold rounded-xl text-sm hover:bg-surface-container-highest transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Icon name="download" size="sm" />
      Export Report
    </button>
  );
}

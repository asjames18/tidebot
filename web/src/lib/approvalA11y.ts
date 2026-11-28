export type ApprovalDecision = 'allow' | 'always' | 'deny';

const APPROVAL_OUTCOME: Record<string, string> = {
  allowed: 'Allowed once',
  always: 'Always allowed',
  denied: 'Not allowed',
  expired: 'Expired',
};

const KNOWN_TOOLKITS: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  hubspot: 'HubSpot',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  clickup: 'ClickUp',
  googledocs: 'Google Docs',
  googledrive: 'Google Drive',
  googlesheets: 'Google Sheets',
  googlecalendar: 'Google Calendar',
  googletasks: 'Google Tasks',
  googlemeet: 'Google Meet',
};

function humanizeSlug(slug: string): string {
  const key = slug.trim().toLowerCase();
  return (
    KNOWN_TOOLKITS[key]
    ?? slug
      .trim()
      .replace(/^(google|microsoft)(?=\w)/i, '$1 ')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** Human-readable tool label used in approval card screen-reader labels. */
export function formatApprovalToolName(tool: string, toolkit?: string): string {
  const cleaned = tool.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (cleaned) {
    return cleaned.toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }
  if (toolkit && toolkit.trim()) {
    return humanizeSlug(toolkit);
  }
  return 'this action';
}

/**
 * Accessible button name for an approval action.
 * Starts with the visible button label (WCAG 2.5.3 Label in Name) and names the tool.
 */
export function approvalActionLabel(
  decision: ApprovalDecision,
  toolLabel: string,
  busyDecision?: string | null,
): string {
  if (decision === 'deny') {
    return busyDecision === 'deny' ? `Denying ${toolLabel}` : `Don't allow ${toolLabel}`;
  }
  if (decision === 'always') {
    return busyDecision === 'always' ? `Saving always allow for ${toolLabel}` : `Always allow ${toolLabel}`;
  }
  return busyDecision === 'allow' ? `Allowing ${toolLabel}` : `Allow once: ${toolLabel}`;
}

/** Visible outcome text and screen-reader suffix naming the tool once resolved. */
export function approvalOutcomeAnnouncement(
  status: string,
  toolLabel: string,
): { text: string; srSuffix: string; announcement: string } {
  const text = APPROVAL_OUTCOME[status] ?? status;
  const srSuffix = ` for ${toolLabel}`;
  return { text, srSuffix, announcement: `${text}${srSuffix}` };
}

/**
 * Move focus to the resolved outcome region only when the card transitions
 * from pending to resolved while keyboard/user focus originated inside the card.
 */
export function shouldFocusApprovalOutcome(
  wasPending: boolean,
  isPending: boolean,
  hadCardFocus: boolean,
): boolean {
  return wasPending && !isPending && hadCardFocus;
}

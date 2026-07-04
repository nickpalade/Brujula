import { CATEGORY_LABEL } from '../shared/urgency.js';

function titleCase(value) {
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getReportTitle(report) {
  if (!report) return 'Field report';

  const category = report.parsed_category
    ? CATEGORY_LABEL[report.parsed_category] ?? titleCase(report.parsed_category)
    : null;
  const location = report.parsed_location?.trim();

  if (category && location) return `${category} · ${location}`;
  if (location) return `Report · ${location}`;
  if (category) return `${category} report`;
  return report.reported_by?.trim() || 'Field report';
}

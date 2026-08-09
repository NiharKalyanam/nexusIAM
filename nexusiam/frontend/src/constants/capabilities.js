// Central capabilities registry — used by WorkgroupsPage, UsersPage (User Rights tab),
// CapabilitiesPage, and any future component that needs the full list.
// Keys MUST match what's stored in the DB / backend platform_capabilities table.

export const CAPABILITIES = [
  { key: 'iam_administrator',        label: 'IAM Administrator',        desc: 'Full system access — all pages and actions' },
  { key: 'application_administrator',label: 'Application Administrator', desc: 'Manage applications and connectors' },
  { key: 'access_request_approver',  label: 'Access Request Approver',  desc: 'Approve or reject access requests' },
  { key: 'auditor',                  label: 'Auditor',                  desc: 'Read-only access to audit logs and reports' },
  { key: 'certification_manager',    label: 'Certification Manager',    desc: 'Manage access certifications and campaigns' },
  { key: 'provisioning_manager',     label: 'Provisioning Manager',     desc: 'Manage provisioning policies and rules' },
  { key: 'helpdesk',                 label: 'Helpdesk',                 desc: 'Reset passwords, unlock accounts, basic user management' },
];

// Lookup helper: key → label
export const capabilityLabel = (key) => {
  const found = CAPABILITIES.find(c => c.key === key);
  return found ? found.label : key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  Plus,
  UserX,
  Pencil,
  Settings2,
  Trash2,
  Search,
  Fingerprint,
  Eye,
  Paperclip,
  Upload,
  User,
  Download,
  FileText,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  Bell,
  CalendarDays,
  Users,
  Sun,
} from 'lucide-react';
import BankAccountSelect from '../components/BankAccountSelect';
import api from '../api/client';
import { PageHeader, PrimaryButton, SecondaryButton, IconButton, Card, StatCard, EmptyState, Modal, Field, inputClass } from '../components/ui';
import { fetchFileBlobUrl, viewFile } from '../api/docActions';
import { Can, useCan } from '../components/Permission';
import SalaryAdvance from './SalaryAdvance';
import { localISODate } from '../utils/dates';

// Common document types kept as suggestions (via <datalist>) rather than
// a fixed list — the office can still type any label ("and many more").
const DOCUMENT_LABEL_SUGGESTIONS = [
  'Residence ID',
  'Passport',
  'Visa',
  'Employment Contract',
  'National ID',
  'Certificate',
];

// Employee.role now matches a Designation's name (see "connect all
// steps"), but existing employees saved under the original 6 fixed slugs
// (from before Designation existed) still need a nice display label —
// this map covers those. A Designation name is shown as-is.
const DEFAULT_ROLE_LABELS: Record<string, string> = {
  ceo: 'CEO',
  md: 'MD',
  accountant: 'Accountant',
  production_staff: 'Production Staff',
  sales_staff: 'Sales Staff',
  admin: 'Admin',
};
function roleLabel(name?: string) {
  if (!name) return '-';
  return DEFAULT_ROLE_LABELS[name] || name;
}

// Employee.role now matches a Designation's name (Designation replaced
// the old fixed Role list) — this finds that designation's tag color for
// the badge shown on the Employees list. Falls back to a neutral gray for
// legacy role values (e.g. "ceo", "admin") that pre-date Designations.
function designationColorFor(designations: { name: string; color: string }[], roleName?: string) {
  return designations.find((d) => d.name === roleName)?.color;
}

const ATTENDANCE_STATUS_OPTIONS = [
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'late', label: 'Late' },
  { value: 'half_day', label: 'Half day' },
  { value: 'leave', label: 'Leave' },
  { value: 'weekend', label: 'Weekly Off' },
];

function labelFor(options: { value: string; label: string }[], value?: string) {
  if (!value) return '-';
  return options.find((o) => o.value === value)?.label || value;
}

const EMPLOYMENT_TYPE_OPTIONS = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'temporary', label: 'Temporary' },
];

const EMPLOYEE_STATUS_OPTIONS = [
  { value: 'working', label: 'Working' },
  { value: 'terminated', label: 'Terminated' },
  { value: 'others', label: 'Others' },
];

// ISO 3166-1 alpha-2 country list for the "Others Detail" Nationality
// dropdown. Bangladesh and the GCC countries are pinned to the top since
// most of this workforce is expected to come from there; the rest follow
// alphabetically by name.
const PINNED_COUNTRY_CODES = ['BD', 'OM', 'SA', 'AE', 'QA', 'KW', 'BH', 'IN', 'NP', 'PK', 'LK', 'PH'];
const COUNTRY_LIST: { code: string; name: string }[] = [
  { code: 'AF', name: 'Afghanistan' }, { code: 'AL', name: 'Albania' }, { code: 'DZ', name: 'Algeria' },
  { code: 'AD', name: 'Andorra' }, { code: 'AO', name: 'Angola' }, { code: 'AG', name: 'Antigua and Barbuda' },
  { code: 'AR', name: 'Argentina' }, { code: 'AM', name: 'Armenia' }, { code: 'AU', name: 'Australia' },
  { code: 'AT', name: 'Austria' }, { code: 'AZ', name: 'Azerbaijan' }, { code: 'BS', name: 'Bahamas' },
  { code: 'BH', name: 'Bahrain' }, { code: 'BD', name: 'Bangladesh' }, { code: 'BB', name: 'Barbados' },
  { code: 'BY', name: 'Belarus' }, { code: 'BE', name: 'Belgium' }, { code: 'BZ', name: 'Belize' },
  { code: 'BJ', name: 'Benin' }, { code: 'BT', name: 'Bhutan' }, { code: 'BO', name: 'Bolivia' },
  { code: 'BA', name: 'Bosnia and Herzegovina' }, { code: 'BW', name: 'Botswana' }, { code: 'BR', name: 'Brazil' },
  { code: 'BN', name: 'Brunei' }, { code: 'BG', name: 'Bulgaria' }, { code: 'BF', name: 'Burkina Faso' },
  { code: 'BI', name: 'Burundi' }, { code: 'KH', name: 'Cambodia' }, { code: 'CM', name: 'Cameroon' },
  { code: 'CA', name: 'Canada' }, { code: 'CV', name: 'Cape Verde' }, { code: 'CF', name: 'Central African Republic' },
  { code: 'TD', name: 'Chad' }, { code: 'CL', name: 'Chile' }, { code: 'CN', name: 'China' },
  { code: 'CO', name: 'Colombia' }, { code: 'KM', name: 'Comoros' }, { code: 'CG', name: 'Congo' },
  { code: 'CD', name: 'Congo (DRC)' }, { code: 'CR', name: 'Costa Rica' }, { code: 'CI', name: "Cote d'Ivoire" },
  { code: 'HR', name: 'Croatia' }, { code: 'CU', name: 'Cuba' }, { code: 'CY', name: 'Cyprus' },
  { code: 'CZ', name: 'Czech Republic' }, { code: 'DK', name: 'Denmark' }, { code: 'DJ', name: 'Djibouti' },
  { code: 'DM', name: 'Dominica' }, { code: 'DO', name: 'Dominican Republic' }, { code: 'EC', name: 'Ecuador' },
  { code: 'EG', name: 'Egypt' }, { code: 'SV', name: 'El Salvador' }, { code: 'GQ', name: 'Equatorial Guinea' },
  { code: 'ER', name: 'Eritrea' }, { code: 'EE', name: 'Estonia' }, { code: 'SZ', name: 'Eswatini' },
  { code: 'ET', name: 'Ethiopia' }, { code: 'FJ', name: 'Fiji' }, { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' }, { code: 'GA', name: 'Gabon' }, { code: 'GM', name: 'Gambia' },
  { code: 'GE', name: 'Georgia' }, { code: 'DE', name: 'Germany' }, { code: 'GH', name: 'Ghana' },
  { code: 'GR', name: 'Greece' }, { code: 'GD', name: 'Grenada' }, { code: 'GT', name: 'Guatemala' },
  { code: 'GN', name: 'Guinea' }, { code: 'GW', name: 'Guinea-Bissau' }, { code: 'GY', name: 'Guyana' },
  { code: 'HT', name: 'Haiti' }, { code: 'HN', name: 'Honduras' }, { code: 'HK', name: 'Hong Kong' },
  { code: 'HU', name: 'Hungary' }, { code: 'IS', name: 'Iceland' }, { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' }, { code: 'IR', name: 'Iran' }, { code: 'IQ', name: 'Iraq' },
  { code: 'IE', name: 'Ireland' }, { code: 'IL', name: 'Israel' }, { code: 'IT', name: 'Italy' },
  { code: 'JM', name: 'Jamaica' }, { code: 'JP', name: 'Japan' }, { code: 'JO', name: 'Jordan' },
  { code: 'KZ', name: 'Kazakhstan' }, { code: 'KE', name: 'Kenya' }, { code: 'KI', name: 'Kiribati' },
  { code: 'KP', name: 'North Korea' }, { code: 'KR', name: 'South Korea' }, { code: 'KW', name: 'Kuwait' },
  { code: 'KG', name: 'Kyrgyzstan' }, { code: 'LA', name: 'Laos' }, { code: 'LV', name: 'Latvia' },
  { code: 'LB', name: 'Lebanon' }, { code: 'LS', name: 'Lesotho' }, { code: 'LR', name: 'Liberia' },
  { code: 'LY', name: 'Libya' }, { code: 'LI', name: 'Liechtenstein' }, { code: 'LT', name: 'Lithuania' },
  { code: 'LU', name: 'Luxembourg' }, { code: 'MG', name: 'Madagascar' }, { code: 'MW', name: 'Malawi' },
  { code: 'MY', name: 'Malaysia' }, { code: 'MV', name: 'Maldives' }, { code: 'ML', name: 'Mali' },
  { code: 'MT', name: 'Malta' }, { code: 'MR', name: 'Mauritania' }, { code: 'MU', name: 'Mauritius' },
  { code: 'MX', name: 'Mexico' }, { code: 'MD', name: 'Moldova' }, { code: 'MC', name: 'Monaco' },
  { code: 'MN', name: 'Mongolia' }, { code: 'ME', name: 'Montenegro' }, { code: 'MA', name: 'Morocco' },
  { code: 'MZ', name: 'Mozambique' }, { code: 'MM', name: 'Myanmar' }, { code: 'NA', name: 'Namibia' },
  { code: 'NP', name: 'Nepal' }, { code: 'NL', name: 'Netherlands' }, { code: 'NZ', name: 'New Zealand' },
  { code: 'NI', name: 'Nicaragua' }, { code: 'NE', name: 'Niger' }, { code: 'NG', name: 'Nigeria' },
  { code: 'MK', name: 'North Macedonia' }, { code: 'NO', name: 'Norway' }, { code: 'OM', name: 'Oman' },
  { code: 'PK', name: 'Pakistan' }, { code: 'PA', name: 'Panama' }, { code: 'PG', name: 'Papua New Guinea' },
  { code: 'PY', name: 'Paraguay' }, { code: 'PE', name: 'Peru' }, { code: 'PH', name: 'Philippines' },
  { code: 'PL', name: 'Poland' }, { code: 'PT', name: 'Portugal' }, { code: 'QA', name: 'Qatar' },
  { code: 'RO', name: 'Romania' }, { code: 'RU', name: 'Russia' }, { code: 'RW', name: 'Rwanda' },
  { code: 'WS', name: 'Samoa' }, { code: 'SM', name: 'San Marino' }, { code: 'SA', name: 'Saudi Arabia' },
  { code: 'SN', name: 'Senegal' }, { code: 'RS', name: 'Serbia' }, { code: 'SC', name: 'Seychelles' },
  { code: 'SL', name: 'Sierra Leone' }, { code: 'SG', name: 'Singapore' }, { code: 'SK', name: 'Slovakia' },
  { code: 'SI', name: 'Slovenia' }, { code: 'SO', name: 'Somalia' }, { code: 'ZA', name: 'South Africa' },
  { code: 'SS', name: 'South Sudan' }, { code: 'ES', name: 'Spain' }, { code: 'LK', name: 'Sri Lanka' },
  { code: 'SD', name: 'Sudan' }, { code: 'SR', name: 'Suriname' }, { code: 'SE', name: 'Sweden' },
  { code: 'CH', name: 'Switzerland' }, { code: 'SY', name: 'Syria' }, { code: 'TW', name: 'Taiwan' },
  { code: 'TJ', name: 'Tajikistan' }, { code: 'TZ', name: 'Tanzania' }, { code: 'TH', name: 'Thailand' },
  { code: 'TL', name: 'Timor-Leste' }, { code: 'TG', name: 'Togo' }, { code: 'TO', name: 'Tonga' },
  { code: 'TT', name: 'Trinidad and Tobago' }, { code: 'TN', name: 'Tunisia' }, { code: 'TR', name: 'Turkey' },
  { code: 'TM', name: 'Turkmenistan' }, { code: 'UG', name: 'Uganda' }, { code: 'UA', name: 'Ukraine' },
  { code: 'AE', name: 'United Arab Emirates' }, { code: 'GB', name: 'United Kingdom' }, { code: 'US', name: 'United States' },
  { code: 'UY', name: 'Uruguay' }, { code: 'UZ', name: 'Uzbekistan' }, { code: 'VU', name: 'Vanuatu' },
  { code: 'VA', name: 'Vatican City' }, { code: 'VE', name: 'Venezuela' }, { code: 'VN', name: 'Vietnam' },
  { code: 'YE', name: 'Yemen' }, { code: 'ZM', name: 'Zambia' }, { code: 'ZW', name: 'Zimbabwe' },
];
const SORTED_COUNTRY_LIST = [
  ...PINNED_COUNTRY_CODES.map((c) => COUNTRY_LIST.find((x) => x.code === c)!).filter(Boolean),
  ...COUNTRY_LIST.filter((c) => !PINNED_COUNTRY_CODES.includes(c.code)).sort((a, b) => a.name.localeCompare(b.name)),
];
function countryName(code?: string) {
  return COUNTRY_LIST.find((c) => c.code === code)?.name || code || '';
}
// Converts an ISO 3166-1 alpha-2 code (e.g. "BD") into its flag emoji via
// Unicode regional indicator symbols. Only used inside a <select><option>
// below, where a real flag icon can't be rendered (options are plain text) —
// everywhere else use <CountryFlag>, which renders an actual flag picture.
function flagEmoji(code?: string) {
  if (!code || code.length !== 2) return '';
  const points = code
    .toUpperCase()
    .split('')
    .map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...points);
}

// Real flag icon (bundled SVG sprite via the "flag-icons" package, see
// main.tsx) — used instead of the flag emoji everywhere except inside a
// <select><option>, since most Windows browsers show flag emoji as plain
// two-letter text ("BD") rather than a picture, having no built-in color
// flag glyphs.
function CountryFlag({ code, size = 16 }: { code?: string; size?: number }) {
  if (!code) return null;
  return (
    <span
      className={`fi fi-${code.toLowerCase()} rounded-sm shrink-0`}
      title={countryName(code)}
      style={{ width: size, height: size * 0.75 }}
    />
  );
}

interface Employee {
  id: string;
  name: string;
  role: string;
  phone?: string;
  email?: string;
  active: boolean;
  joinedDate?: string;
  staffId?: string;
  department?: string;
  team?: string;
  shift?: string;
  baseSalary?: number;
  housingAllowance?: number;
  transportAllowance?: number;
  otherAllowance?: number;
  socialProtectionCovered?: boolean;
  leftDate?: string | null;
  otRatePerHour?: number;
  biometricId?: string;
  photoPath?: string;
  employmentType?: string;
  status?: string;
  archiveType?: 'old' | 'temporary' | null;
  archivedAt?: string | null;
  // --- "Others Detail" section (all optional) ---
  fatherName?: string;
  motherName?: string;
  birthDate?: string;
  passportNumber?: string;
  nationality?: string; // ISO 3166-1 alpha-2 country code, e.g. "BD"
  originCountryIdNumber?: string;
  homeAddress?: string;
  educationalQualifications?: string;
  skills?: string;
  certifications?: string;
  guardianName?: string;
  guardianPhone?: string;
  guardianNationalId?: string;
  guardianRelationship?: string;
  guardianAddress?: string;
  emergencyPhone1?: string;
  emergencyPhone2?: string;
  guardianPhotoPath?: string;
  nomineeName?: string;
  nomineeNationalId?: string;
  nomineePhone?: string;
  nomineeRelationship?: string;
  nomineePhotoPath?: string;
}
interface EmployeeDocument {
  id: string;
  employeeId: string;
  label: string;
  originalName: string;
  uploadedAt: string;
}
interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  lunchIn?: string;
  lunchOut?: string;
  breakMinutes?: number;
  source?: 'manual' | 'device';
  status: string;
  notes?: string;
  overtimeHours?: number;
}
interface RoleOrTeam {
  id: string;
  name: string;
}

const statusTone: Record<string, string> = {
  present: 'bg-brand-50 text-brand-700',
  late: 'bg-amber-50 text-amber-700',
  half_day: 'bg-amber-50 text-amber-700',
  absent: 'bg-red-50 text-red-600',
  leave: 'bg-black/5 text-ink/70',
  weekend: 'bg-black/5 text-ink/60',
};

function todayStr() {
  return localISODate();
}

// 0 = Sunday … 6 = Saturday, matching JS Date#getDay() and the backend's
// Settings.weeklyOffDays comment.
function isWeeklyOffDate(dateStr: string, weeklyOffDays?: string) {
  const days = (weeklyOffDays || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (days.length === 0) return false;
  // Parse as a local calendar date (not UTC) so the day-of-week matches
  // what the user picked in the date input.
  const [y, m, d] = dateStr.split('-').map(Number);
  const dayOfWeek = new Date(y, (m || 1) - 1, d || 1).getDay();
  return days.includes(String(dayOfWeek));
}

// Employee photos come from a protected route, so a plain <img src="/employees/:id/photo">
// can't carry the JWT — fetch it as a blob and hand the browser an object
// URL, same pattern as viewing an expense invoice. Falls back to a plain
// placeholder box when there's no photo (or while it's loading).
function EmployeePhoto({ employeeId, hasPhoto, size = 36 }: { employeeId: string; hasPhoto?: boolean; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    if (hasPhoto) {
      fetchFileBlobUrl(`/employees/${employeeId}/photo`).then((u) => {
        if (cancelled) return;
        objectUrl = u;
        setUrl(u);
      }).catch(() => {});
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [employeeId, hasPhoto]);

  return (
    <div
      className="rounded-lg border border-black/10 bg-black/5 flex items-center justify-center overflow-hidden shrink-0"
      style={{ width: size, height: size }}
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <User size={Math.round(size * 0.5)} className="text-muted" />
      )}
    </div>
  );
}

type HrTab =
  | 'dashboard'
  | 'attendance'
  | 'employees'
  | 'department'
  | 'designation'
  | 'shifts'
  | 'projects'
  | 'leave'
  | 'payroll'
  | 'holidays'
  | 'events'
  | 'notices'
  | 'reports';

const HR_TAB_OPTIONS: { value: HrTab; label: string }[] = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'attendance', label: 'Attendance' },
  { value: 'employees', label: 'Employees' },
  { value: 'department', label: 'Department' },
  { value: 'designation', label: 'Designation' },
  { value: 'shifts', label: 'Shifts' },
  { value: 'projects', label: 'Projects' },
  { value: 'leave', label: 'Leave Requests' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'holidays', label: 'Holidays' },
  { value: 'events', label: 'Events' },
  { value: 'notices', label: 'Notices' },
  { value: 'reports', label: 'Reports' },
];

// A tab whose page hasn't been specced/built yet — shown as a simple
// "coming soon" placeholder until its design is given.
const PLACEHOLDER_TABS: { value: HrTab; title: string; subtitle: string }[] = [];

// The HR module has more sections than the generic Pill component was
// designed for (13, vs. the 2-4 elsewhere), so a plain single-row Pill
// either overflows or scrolls awkwardly. This lays them out as a grid
// that settles into two neat rows on a normal desktop width, with its
// own hover/active treatment (lift + glow on hover, solid fill when
// selected) rather than reusing Pill's simple toggle style.
function HrTabBar({ tab, onChange }: { tab: HrTab; onChange: (t: HrTab) => void }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-2 mb-5">
      {HR_TAB_OPTIONS.map((opt) => {
        const active = tab === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-3 py-2 rounded-lg text-sm font-medium text-center border transition-all duration-200 ease-out ${
              active
                ? 'bg-brand-500 border-brand-500 text-ink shadow-sm'
                : 'bg-white border-black/10 text-ink/70 hover:-translate-y-0.5 hover:shadow-md hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default function HR() {
  const [tab, setTab] = useState<HrTab>('attendance');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [teams, setTeams] = useState<RoleOrTeam[]>([]);
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [designations, setDesignations] = useState<DesignationItem[]>([]);
  const [shifts, setShifts] = useState<ShiftItem[]>([]);
  const [weeklyOffDays, setWeeklyOffDays] = useState('');
  const [date, setDate] = useState(todayStr());
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [viewEmployee, setViewEmployee] = useState<Employee | null>(null);
  const [docsEmployee, setDocsEmployee] = useState<Employee | null>(null);
  const [archiveEmployee, setArchiveEmployee] = useState<Employee | null>(null);
  const [showMark, setShowMark] = useState(false);
  const [editAttendance, setEditAttendance] = useState<AttendanceRecord | null>(null);
  const [showManageTeams, setShowManageTeams] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState('');
  // Old/Temporary Employees are now a sub-view of the Employees tab (not
  // separate top-level tabs) — this picks which list is shown there.
  const [employeeSubTab, setEmployeeSubTab] = useState<'active' | 'old' | 'temporary'>('active');

  function loadEmployees() {
    api.get('/employees').then((res) => setEmployees(res.data));
  }
  function loadTeams() {
    api.get('/teams').then((res) => setTeams(res.data));
  }
  function loadDepartments() {
    api.get('/departments').then((res) => setDepartments(res.data));
  }
  function loadDesignations() {
    api.get('/designations').then((res) => setDesignations(res.data));
  }
  function loadShifts() {
    api.get('/shifts').then((res) => setShifts(res.data));
  }
  function loadAttendance() {
    setLoading(true);
    api.get(`/attendance/date/${date}`).then((res) => setRecords(res.data)).finally(() => setLoading(false));
  }

  async function deleteAttendance(id: string, name: string) {
    if (!window.confirm(`Delete ${name}'s attendance entry for ${date}? This cannot be undone.`)) return;
    await api.delete(`/attendance/${id}`);
    loadAttendance();
  }

  useEffect(() => {
    api.get('/settings').then((res) => setWeeklyOffDays(res.data.weeklyOffDays || ''));
  }, []);
  useEffect(() => {
    if (tab === 'attendance') loadAttendance();
    else setLoading(false);
  }, [tab, date]);
  // Employees, Teams, Departments, Designations and Shifts are managed on
  // their own tabs (each with its own local list state) — reloading these
  // five here on every tab switch (not just once on mount) is what keeps
  // the New/Edit Employee dropdowns in sync after adding a Department,
  // Designation or Shift on those tabs, instead of showing whatever was
  // loaded when the page first opened.
  useEffect(() => {
    loadEmployees();
    loadTeams();
    loadDepartments();
    loadDesignations();
    loadShifts();
  }, [tab]);

  function employeeName(id: string) {
    return employees.find((e) => e.id === id)?.name || id;
  }

  async function deactivate(id: string) {
    if (!window.confirm('Deactivate this employee?')) return;
    await api.patch(`/employees/${id}/deactivate`);
    loadEmployees();
  }

  const dateIsWeeklyOff = isWeeklyOffDate(date, weeklyOffDays);

  // Search across name, Staff ID, Team, mobile number, and Department.
  // Archived employees (Old/Temporary) are kept in the same `employees`
  // list from the API but hidden from the normal Employees tab — they
  // live on the Old Employees / Temporary Employees tabs instead.
  const activeEmployeesList = employees.filter((e) => !e.archiveType);
  const oldEmployeesList = employees.filter((e) => e.archiveType === 'old');
  const temporaryEmployeesList = employees.filter((e) => e.archiveType === 'temporary');

  const employeeSearchTerm = employeeSearch.trim().toLowerCase();
  const filteredEmployees = employeeSearchTerm
    ? activeEmployeesList.filter((e) =>
        [e.name, e.staffId, e.team, e.phone, e.department].some((field) =>
          (field || '').toLowerCase().includes(employeeSearchTerm),
        ),
      )
    : activeEmployeesList;

  return (
    <div>
      <HrTabBar tab={tab} onChange={setTab} />

      {tab === 'attendance' ? (
        <>
          <PageHeader
            title="Attendance"
            subtitle="Daily check-in / check-out records"
            action={
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  className={inputClass}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                <PrimaryButton icon={Plus} onClick={() => setShowMark(true)} requires="edit">Mark attendance</PrimaryButton>
              </div>
            }
          />
          {dateIsWeeklyOff && (
            <div className="mb-3 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 inline-block">
              This date is a weekly off day
            </div>
          )}
          {loading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : records.length === 0 ? (
            <EmptyState>No attendance marked for this date yet.</EmptyState>
          ) : (
            <Card>
              <div className="divide-y divide-black/5">
                {records.map((r) => (
                  <div key={r.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink flex items-center gap-1.5">
                        {employeeName(r.employeeId)}
                        {r.source === 'device' && (
                          <span title="Recorded by fingerprint device" className="text-brand-600">
                            <Fingerprint size={13} />
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted">
                        {r.checkIn || '-'} – {r.checkOut || '-'}
                        {r.lunchIn || r.lunchOut ? ` · Lunch ${r.lunchIn || '-'}–${r.lunchOut || '-'}` : ''}
                        {r.breakMinutes != null ? ` · ${r.breakMinutes}m break` : ''}
                        {Number(r.overtimeHours) > 0 ? ` · +${Number(r.overtimeHours).toFixed(2)}h OT` : ''}
                        {r.notes ? ` · ${r.notes}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusTone[r.status] || 'bg-black/5 text-ink/70'}`}>
                        {labelFor(ATTENDANCE_STATUS_OPTIONS, r.status)}
                      </span>
                      <IconButton icon={Pencil} title="Edit attendance" onClick={() => setEditAttendance(r)} requires="edit" />
                      <IconButton icon={Trash2} tone="danger" title="Delete attendance" onClick={() => deleteAttendance(r.id, employeeName(r.employeeId))} requires="full" />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {showMark && (
            <MarkAttendanceModal
              employees={employees}
              date={date}
              defaultWeeklyOff={dateIsWeeklyOff}
              onClose={() => setShowMark(false)}
              onSaved={() => {
                setShowMark(false);
                loadAttendance();
              }}
            />
          )}
          {editAttendance && (
            <MarkAttendanceModal
              employees={employees}
              date={editAttendance.date}
              record={editAttendance}
              onClose={() => setEditAttendance(null)}
              onSaved={() => {
                setEditAttendance(null);
                loadAttendance();
              }}
            />
          )}
        </>
      ) : tab === 'employees' ? (
        <>
          <PageHeader
            title="Employees"
            subtitle="Everyone on payroll"
            action={
              employeeSubTab === 'active' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-full sm:w-56">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      className={`${inputClass} pl-8`}
                      value={employeeSearch}
                      onChange={(e) => setEmployeeSearch(e.target.value)}
                      placeholder="Search name, ID, team, mobile, department"
                    />
                  </div>
                  <SecondaryButton icon={Settings2} onClick={() => setShowManageTeams(true)} requires="edit">Manage teams</SecondaryButton>
                  <PrimaryButton icon={Plus} onClick={() => setShowAddEmployee(true)} requires="edit">New employee</PrimaryButton>
                </div>
              ) : undefined
            }
          />

          {/* Old/Temporary Employees live here as a sub-view instead of
              their own top-level tabs. */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {(
              [
                { value: 'active', label: 'Employees' },
                { value: 'old', label: 'Old Employees' },
                { value: 'temporary', label: 'Temporary Employees' },
              ] as const
            ).map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setEmployeeSubTab(o.value)}
                className={`text-sm font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                  employeeSubTab === o.value
                    ? 'bg-brand-500 border-brand-500 text-ink'
                    : 'bg-white border-black/10 text-ink/70 hover:bg-black/5'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {employeeSubTab === 'active' ? (
            <>
              {activeEmployeesList.length === 0 ? (
                <EmptyState>No employees yet.</EmptyState>
              ) : filteredEmployees.length === 0 ? (
                <EmptyState>No employees match "{employeeSearch}".</EmptyState>
              ) : (
                <Card>
                  <div className="divide-y divide-black/5">
                    {filteredEmployees.map((e) => (
                      <div key={e.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-ink flex flex-wrap items-center gap-1.5">
                            {e.name}
                            {e.staffId ? <span className="whitespace-nowrap">{` · ${e.staffId}`}</span> : ''}
                            {e.biometricId && (
                              <span title="Fingerprint enrolled" className="text-brand-600">
                                <Fingerprint size={13} />
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted flex items-center gap-1.5 flex-wrap">
                            <span className="inline-flex items-center gap-1">
                              <span
                                className="inline-block w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: designationColorFor(designations, e.role) || '#9ca3af' }}
                              />
                              {roleLabel(e.role)}
                            </span>
                            · {e.phone || e.email || '-'}
                            {e.department ? ` · ${e.department}` : ''}
                            {e.team ? ` · ${e.team}` : ''}
                            {e.shift ? ` · ${e.shift} shift` : ''}
                            {e.employmentType ? ` · ${labelFor(EMPLOYMENT_TYPE_OPTIONS, e.employmentType)}` : ''}
                            {e.status && e.status !== 'working' ? ` · ${labelFor(EMPLOYEE_STATUS_OPTIONS, e.status)}` : ''}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap sm:shrink-0">
                          <CountryFlag code={e.nationality} size={22} />
                          <EmployeePhoto employeeId={e.id} hasPhoto={!!e.photoPath} />
                          {!e.active && <span className="text-xs px-2 py-1 rounded-full bg-black/5 text-ink/60 font-medium">Inactive</span>}
                          <IconButton icon={Eye} title="View details" onClick={() => setViewEmployee(e)} />
                          <IconButton icon={Pencil} title="Edit employee" onClick={() => setEditEmployee(e)} requires="edit" />
                          <IconButton icon={Paperclip} title="Documents" onClick={() => setDocsEmployee(e)} />
                          {e.active && <IconButton icon={UserX} tone="danger" title="Deactivate" onClick={() => deactivate(e.id)} requires="edit" />}
                          <IconButton icon={Trash2} tone="danger" title="Delete" onClick={() => setArchiveEmployee(e)} requires="edit" />
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              {showAddEmployee && (
                <AddEmployeeModal
                  designations={designations}
                  teams={teams}
                  departments={departments}
                  shifts={shifts}
                  onClose={() => setShowAddEmployee(false)}
                  onSaved={() => {
                    setShowAddEmployee(false);
                    loadEmployees();
                  }}
                />
              )}
              {editEmployee && (
                <EditEmployeeModal
                  employee={editEmployee}
                  designations={designations}
                  teams={teams}
                  departments={departments}
                  shifts={shifts}
                  onClose={() => setEditEmployee(null)}
                  onSaved={() => {
                    setEditEmployee(null);
                    loadEmployees();
                  }}
                />
              )}
              {viewEmployee && <ViewEmployeeModal employee={viewEmployee} departments={departments} onClose={() => setViewEmployee(null)} />}
              {docsEmployee && <EmployeeDocumentsModal employee={docsEmployee} onClose={() => setDocsEmployee(null)} />}
              {archiveEmployee && (
                <ArchiveEmployeeModal
                  employee={archiveEmployee}
                  onClose={() => setArchiveEmployee(null)}
                  onDone={() => {
                    setArchiveEmployee(null);
                    loadEmployees();
                  }}
                />
              )}
              {showManageTeams && (
                <ManageListModal
                  title="Manage teams"
                  items={teams}
                  createPath="/teams"
                  deletePath={(id) => `/teams/${id}`}
                  onClose={() => setShowManageTeams(false)}
                  onChanged={loadTeams}
                />
              )}
            </>
          ) : employeeSubTab === 'old' ? (
            <ArchivedEmployeesTab
              archiveType="old"
              subtitle="Former staff who worked 15+ days and were paid — archived, not deleted."
              employees={oldEmployeesList}
              designations={designations}
              onChanged={loadEmployees}
            />
          ) : (
            <ArchivedEmployeesTab
              archiveType="temporary"
              subtitle="Staff who worked under 15 days (and were paid) — archived, not deleted."
              employees={temporaryEmployeesList}
              designations={designations}
              onChanged={loadEmployees}
            />
          )}
        </>
      ) : tab === 'department' ? (
        <DepartmentTab />
      ) : tab === 'designation' ? (
        <DesignationTab onViewDepartment={() => setTab('department')} />
      ) : tab === 'shifts' ? (
        <ShiftTab />
      ) : tab === 'projects' ? (
        <ProjectTab employees={employees} />
      ) : tab === 'leave' ? (
        <LeaveRequestTab employees={employees} />
      ) : tab === 'reports' ? (
        <AttendanceReportsTab employees={employees} departments={departments} />
      ) : tab === 'payroll' ? (
        <PayrollTab employees={employees} />
      ) : tab === 'events' ? (
        <EventTab />
      ) : tab === 'notices' ? (
        <NoticeTab />
      ) : tab === 'holidays' ? (
        <HolidayTab />
      ) : tab === 'dashboard' ? (
        <DashboardTab employees={employees} shifts={shifts} />
      ) : (
        <HrPlaceholderTab tab={tab} />
      )}
    </div>
  );
}

// Shown for any tab whose page hasn't been specced/built yet — replaced
// with the real page once its design is given.
function HrPlaceholderTab({ tab }: { tab: HrTab }) {
  const meta = PLACEHOLDER_TABS.find((t) => t.value === tab);
  return (
    <>
      <PageHeader title={meta?.title || tab} subtitle={meta?.subtitle} />
      <EmptyState>This section is on the menu but not built yet — coming soon.</EmptyState>
    </>
  );
}

interface DepartmentItem {
  id: string;
  name: string;
  otRatePerHour?: number;
}

function DepartmentTab() {
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editDept, setEditDept] = useState<DepartmentItem | null>(null);

  function load() {
    setLoading(true);
    api.get('/departments').then((res) => setDepartments(res.data)).finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function onDelete(dept: DepartmentItem) {
    if (!window.confirm(`Remove the "${dept.name}" department?`)) return;
    await api.delete(`/departments/${dept.id}`);
    load();
  }

  return (
    <>
      <PageHeader
        title="Department"
        subtitle="Manage company departments and internal structures."
        action={<PrimaryButton icon={Plus} onClick={() => setShowAdd(true)} requires="edit">Add Department</PrimaryButton>}
      />

      <Card>
        <div className="px-4 py-3 border-b border-black/10">
          <h3 className="text-sm font-semibold text-brand-700">Departments</h3>
        </div>
        {loading ? (
          <div className="p-4 text-sm text-muted">Loading…</div>
        ) : departments.length === 0 ? (
          <EmptyState>No departments added yet.</EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-[36px_1fr_92px_76px] sm:grid-cols-[60px_1fr_140px_100px] px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wide bg-black/[0.02]">
              <span>No.</span>
              <span>Name</span>
              <span>Default OT Rate</span>
              <span className="text-right">Action</span>
            </div>
            <div className="divide-y divide-black/5">
              {departments.map((d, i) => (
                <div key={d.id} className="grid grid-cols-[36px_1fr_92px_76px] sm:grid-cols-[60px_1fr_140px_100px] items-center px-4 py-3">
                  <span className="text-sm text-muted">{i + 1}.</span>
                  <span className="text-sm text-ink">{d.name}</span>
                  <span className="text-sm text-muted">{d.otRatePerHour != null ? Number(d.otRatePerHour).toFixed(2) + '/hr' : '-'}</span>
                  <div className="flex items-center justify-end gap-2">
                    <IconButton icon={Pencil} title="Edit" onClick={() => setEditDept(d)} requires="edit" />
                    <IconButton icon={Trash2} tone="danger" title="Remove" onClick={() => onDelete(d)} requires="full" />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {showAdd && (
        <DepartmentFormModal
          title="Add Department"
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
      {editDept && (
        <DepartmentFormModal
          title="Edit Department"
          department={editDept}
          onClose={() => setEditDept(null)}
          onSaved={() => {
            setEditDept(null);
            load();
          }}
        />
      )}
    </>
  );
}

function DepartmentFormModal({
  title,
  department,
  onClose,
  onSaved,
}: {
  title: string;
  department?: DepartmentItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(department?.name || '');
  const [otRatePerHour, setOtRatePerHour] = useState(department?.otRatePerHour != null ? String(department.otRatePerHour) : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const payload = { name: name.trim(), otRatePerHour: otRatePerHour ? Number(otRatePerHour) : undefined };
      if (department) {
        await api.patch(`/departments/${department.id}`, payload);
      } else {
        await api.post('/departments', payload);
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Department name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Production" required />
        </Field>
        <Field label="Default OT Rate (per hour, optional)">
          <input
            className={inputClass}
            type="number"
            min="0"
            step="0.01"
            value={otRatePerHour}
            onChange={(e) => setOtRatePerHour(e.target.value)}
            placeholder="e.g. 1.50"
          />
        </Field>
        <p className="text-xs text-muted -mt-1.5">
          Used for everyone in this department unless an employee has their own OT Rate Override (Employees tab).
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy || !name.trim()} requires="edit">{busy ? 'Saving…' : 'Save'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

interface DesignationItem {
  id: string;
  name: string;
  department?: string;
  color: string;
  active: boolean;
}

function DesignationTab({ onViewDepartment }: { onViewDepartment: () => void }) {
  const [designations, setDesignations] = useState<DesignationItem[]>([]);
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<DesignationItem | null>(null);

  function load() {
    setLoading(true);
    api.get('/designations').then((res) => setDesignations(res.data)).finally(() => setLoading(false));
  }

  useEffect(load, []);
  useEffect(() => {
    api.get('/departments').then((res) => setDepartments(res.data));
  }, []);

  async function onDelete(item: DesignationItem) {
    if (!window.confirm(`Remove the "${item.name}" designation?`)) return;
    await api.delete(`/designations/${item.id}`);
    load();
  }

  return (
    <>
      <PageHeader
        title="Designations"
        subtitle="Manage company departments and employee job designations."
        action={
          <div className="flex items-center gap-2">
            <SecondaryButton icon={Eye} onClick={onViewDepartment}>View Department</SecondaryButton>
            <PrimaryButton icon={Plus} onClick={() => setShowAdd(true)} requires="edit">Add Designation</PrimaryButton>
          </div>
        }
      />

      <Card>
        <div className="px-4 py-3 border-b border-black/10">
          <h3 className="text-sm font-semibold text-brand-700">Designations</h3>
        </div>
        {loading ? (
          <div className="p-4 text-sm text-muted">Loading…</div>
        ) : designations.length === 0 ? (
          <EmptyState>No designations added yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid grid-cols-[50px_1.2fr_1fr_110px_90px_100px] px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wide bg-black/[0.02] min-w-[720px]">
              <span>No.</span>
              <span>Name</span>
              <span>Department</span>
              <span>Color</span>
              <span>Status</span>
              <span className="text-right">Action</span>
            </div>
            <div className="divide-y divide-black/5 min-w-[720px]">
              {designations.map((d, i) => (
                <div key={d.id} className="grid grid-cols-[50px_1.2fr_1fr_110px_90px_100px] items-center px-4 py-3">
                  <span className="text-sm text-muted">{i + 1}.</span>
                  <span className="text-sm text-ink">{d.name}</span>
                  <span className="text-sm text-muted">{d.department || '-'}</span>
                  <span>
                    <span
                      className="inline-block text-[11px] font-mono text-white px-2 py-1 rounded-md"
                      style={{ backgroundColor: d.color }}
                    >
                      {d.color}
                    </span>
                  </span>
                  <span
                    className={`inline-block w-fit text-xs px-2 py-1 rounded-full font-medium ${
                      d.active ? 'bg-brand-50 text-brand-700' : 'bg-black/5 text-ink/60'
                    }`}
                  >
                    {d.active ? 'Active' : 'Inactive'}
                  </span>
                  <div className="flex items-center justify-end gap-2">
                    <IconButton icon={Pencil} title="Edit" onClick={() => setEditItem(d)} requires="edit" />
                    <IconButton icon={Trash2} tone="danger" title="Remove" onClick={() => onDelete(d)} requires="full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {showAdd && (
        <DesignationFormModal
          title="Add Designation"
          departments={departments}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
      {editItem && (
        <DesignationFormModal
          title="Edit Designation"
          designation={editItem}
          departments={departments}
          onClose={() => setEditItem(null)}
          onSaved={() => {
            setEditItem(null);
            load();
          }}
        />
      )}
    </>
  );
}

function DesignationFormModal({
  title,
  designation,
  departments,
  onClose,
  onSaved,
}: {
  title: string;
  designation?: DesignationItem;
  departments: DepartmentItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(designation?.name || '');
  const [department, setDepartment] = useState(designation?.department || '');
  const [color, setColor] = useState(designation?.color || '#4f46e5');
  const [active, setActive] = useState(designation?.active ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const payload = { name: name.trim(), department: department || undefined, color, active };
      if (designation) {
        await api.patch(`/designations/${designation.id}`, payload);
      } else {
        await api.post('/designations', payload);
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Designation name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lab Technician" required />
        </Field>
        <Field label="Department (optional)">
          <select className={inputClass} value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">-</option>
            {!departments.some((dep) => dep.name === department) && department && (
              <option value={department}>{department}</option>
            )}
            {departments.map((dep) => (
              <option key={dep.id} value={dep.name}>
                {dep.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tag color">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-10 h-10 rounded-lg border border-black/15 cursor-pointer shrink-0"
              />
              <input
                className={inputClass}
                value={color}
                onChange={(e) => setColor(e.target.value)}
                pattern="^#[0-9a-fA-F]{6}$"
                title="Hex color like #4f46e5"
              />
            </div>
          </Field>
          <Field label="Status">
            <label className="flex items-center gap-2 h-[38px]">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              <span className="text-sm text-ink">{active ? 'Active' : 'Inactive'}</span>
            </label>
          </Field>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy || !name.trim()} requires="edit">{busy ? 'Saving…' : 'Save'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

interface ShiftItem {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  lateTime?: string;
  active: boolean;
  staffCount?: number;
}

function timeShort(t?: string) {
  return t ? t.slice(0, 5) : '-';
}

function ShiftTab() {
  const [shifts, setShifts] = useState<ShiftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<ShiftItem | null>(null);

  function load() {
    setLoading(true);
    api.get('/shifts').then((res) => setShifts(res.data)).finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function onDelete(item: ShiftItem) {
    if (!window.confirm(`Remove the "${item.name}" shift?`)) return;
    await api.delete(`/shifts/${item.id}`);
    load();
  }

  return (
    <>
      <PageHeader
        title="Shifts"
        subtitle="Manage company shifts and work schedules."
        action={<PrimaryButton icon={Plus} onClick={() => setShowAdd(true)} requires="edit">Add Shift</PrimaryButton>}
      />

      <Card>
        <div className="px-4 py-3 border-b border-black/10">
          <h3 className="text-sm font-semibold text-brand-700">Shifts</h3>
        </div>
        {loading ? (
          <div className="p-4 text-sm text-muted">Loading…</div>
        ) : shifts.length === 0 ? (
          <EmptyState>No shifts added yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid grid-cols-[50px_1.3fr_1fr_1fr_1fr_80px_90px_100px] px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wide bg-black/[0.02] min-w-[820px]">
              <span>No.</span>
              <span>Name</span>
              <span>Start Time</span>
              <span>Ending Time</span>
              <span>Late Time</span>
              <span>Staffs</span>
              <span>Status</span>
              <span className="text-right">Action</span>
            </div>
            <div className="divide-y divide-black/5 min-w-[820px]">
              {shifts.map((s, i) => (
                <div key={s.id} className="grid grid-cols-[50px_1.3fr_1fr_1fr_1fr_80px_90px_100px] items-center px-4 py-3">
                  <span className="text-sm text-muted">{i + 1}.</span>
                  <span className="text-sm text-ink">{s.name}</span>
                  <span className="text-sm text-muted">{timeShort(s.startTime)}</span>
                  <span className="text-sm text-muted">{timeShort(s.endTime)}</span>
                  <span className="text-sm text-muted">{timeShort(s.lateTime)}</span>
                  <span className="text-sm text-ink">{s.staffCount ?? 0}</span>
                  <span
                    className={`inline-block w-fit text-xs px-2 py-1 rounded-full font-medium ${
                      s.active ? 'bg-brand-50 text-brand-700' : 'bg-black/5 text-ink/60'
                    }`}
                  >
                    {s.active ? 'Active' : 'Inactive'}
                  </span>
                  <div className="flex items-center justify-end gap-2">
                    <IconButton icon={Pencil} title="Edit" onClick={() => setEditItem(s)} requires="edit" />
                    <IconButton icon={Trash2} tone="danger" title="Remove" onClick={() => onDelete(s)} requires="full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {showAdd && (
        <ShiftFormModal
          title="Add Shift"
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
      {editItem && (
        <ShiftFormModal
          title="Edit Shift"
          shift={editItem}
          onClose={() => setEditItem(null)}
          onSaved={() => {
            setEditItem(null);
            load();
          }}
        />
      )}
    </>
  );
}

function ShiftFormModal({
  title,
  shift,
  onClose,
  onSaved,
}: {
  title: string;
  shift?: ShiftItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(shift?.name || '');
  const [startTime, setStartTime] = useState(timeShort(shift?.startTime));
  const [endTime, setEndTime] = useState(timeShort(shift?.endTime));
  const [lateTime, setLateTime] = useState(timeShort(shift?.lateTime));
  const [active, setActive] = useState(shift?.active ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !startTime || !endTime) return;
    setBusy(true);
    setError('');
    try {
      const payload = { name: name.trim(), startTime, endTime, lateTime: lateTime || undefined, active };
      if (shift) {
        await api.patch(`/shifts/${shift.id}`, payload);
      } else {
        await api.post('/shifts', payload);
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Shift name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Morning" required />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Start time">
            <input className={inputClass} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          </Field>
          <Field label="Ending time">
            <input className={inputClass} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
          </Field>
          <Field label="Late time (optional)">
            <input className={inputClass} type="time" value={lateTime} onChange={(e) => setLateTime(e.target.value)} />
          </Field>
        </div>
        <Field label="Status">
          <label className="flex items-center gap-2 h-[38px]">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span className="text-sm text-ink">{active ? 'Active' : 'Inactive'}</span>
          </label>
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy || !name.trim() || !startTime || !endTime} requires="edit">
            {busy ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

interface ProjectItem {
  id: string;
  name: string;
  startedOn?: string;
  members?: string;
  tags?: string;
  active: boolean;
}

function formatDate(d?: string) {
  if (!d) return '-';
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const PROJECT_PAGE_SIZE_OPTIONS = [10, 25, 50];

function ProjectTab({ employees }: { employees: Employee[] }) {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<ProjectItem | null>(null);
  const [viewItem, setViewItem] = useState<ProjectItem | null>(null);
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  function load() {
    setLoading(true);
    api.get('/projects').then((res) => setProjects(res.data)).finally(() => setLoading(false));
  }

  useEffect(load, []);
  useEffect(() => setPage(1), [search, pageSize]);

  async function onDelete(item: ProjectItem) {
    if (!window.confirm(`Remove the "${item.name}" project?`)) return;
    await api.delete(`/projects/${item.id}`);
    load();
  }

  const searchTerm = search.trim().toLowerCase();
  const filtered = searchTerm
    ? projects.filter((p) => [p.name, p.members, p.tags].some((f) => (f || '').toLowerCase().includes(searchTerm)))
    : projects;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <>
      <PageHeader title="Projects" subtitle="Organize milestones, assign team members, and monitor operational tasks." />

      <Card>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
          <h3 className="text-sm font-semibold text-brand-700">Active Projects Log</h3>
          <PrimaryButton icon={Plus} onClick={() => setShowAdd(true)} requires="edit">Add Project</PrimaryButton>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-black/10 text-sm">
          <label className="flex items-center gap-2 text-muted">
            Show
            <select
              className="rounded-lg border border-black/15 px-2 py-1 text-sm"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {PROJECT_PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            entries
          </label>
          <div className="relative w-full sm:w-56">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              className={`${inputClass} pl-8`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-4 text-sm text-muted">Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState>{projects.length === 0 ? 'No projects added yet.' : `No projects match "${search}".`}</EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
            <div className="grid grid-cols-[50px_2fr_1fr_1.3fr_1fr_90px_120px] px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wide bg-black/[0.02] min-w-[860px]">
              <span>No.</span>
              <span>Name</span>
              <span>Started On</span>
              <span>Member(s)</span>
              <span>Tags</span>
              <span>Status</span>
              <span className="text-right">Actions</span>
            </div>
            <div className="divide-y divide-black/5 min-w-[860px]">
              {paged.map((p, i) => (
                <div key={p.id} className="grid grid-cols-[50px_2fr_1fr_1.3fr_1fr_90px_120px] items-center px-4 py-3">
                  <span className="text-sm text-muted">{(currentPage - 1) * pageSize + i + 1}.</span>
                  <span className="text-sm text-ink truncate pr-2">{p.name}</span>
                  <span>
                    <span className="inline-block text-xs px-2 py-1 rounded-md border border-black/10 text-ink/70">
                      {formatDate(p.startedOn)}
                    </span>
                  </span>
                  <span className="text-sm text-muted truncate pr-2">{p.members || '-'}</span>
                  <span className="flex flex-wrap gap-1">
                    {(p.tags || '')
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean)
                      .map((t) => (
                        <span key={t} className="text-[11px] px-2 py-0.5 rounded-full border border-brand-200 text-brand-700 bg-brand-50">
                          {t}
                        </span>
                      ))}
                  </span>
                  <span
                    className={`inline-block w-fit text-xs px-2 py-1 rounded-full font-medium ${
                      p.active ? 'bg-brand-50 text-brand-700' : 'bg-black/5 text-ink/60'
                    }`}
                  >
                    {p.active ? 'Active' : 'Inactive'}
                  </span>
                  <div className="flex items-center justify-end gap-2">
                    <IconButton icon={Eye} title="View" onClick={() => setViewItem(p)} />
                    <IconButton icon={Pencil} title="Edit" onClick={() => setEditItem(p)} requires="edit" />
                    <IconButton icon={Trash2} tone="danger" title="Remove" onClick={() => onDelete(p)} requires="full" />
                  </div>
                </div>
              ))}
            </div>
            </div>
            <div className="flex items-center justify-between px-4 py-3 text-xs text-muted">
              <span>
                Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filtered.length)} of{' '}
                {filtered.length} entries
              </span>
              <div className="flex items-center gap-1">
                <SecondaryButton onClick={() => setPage(Math.max(1, currentPage - 1))} className={currentPage === 1 ? 'opacity-50' : ''}>
                  Previous
                </SecondaryButton>
                {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPage(n)}
                    className={`w-8 h-8 rounded-lg text-xs font-medium border ${
                      n === currentPage ? 'bg-brand-500 border-brand-500 text-ink' : 'bg-white border-black/10 text-ink/70 hover:bg-black/5'
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <SecondaryButton
                  onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                  className={currentPage === totalPages ? 'opacity-50' : ''}
                >
                  Next
                </SecondaryButton>
              </div>
            </div>
          </>
        )}
      </Card>

      {showAdd && (
        <ProjectFormModal
          title="Add Project"
          employees={employees}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
      {editItem && (
        <ProjectFormModal
          title="Edit Project"
          project={editItem}
          employees={employees}
          onClose={() => setEditItem(null)}
          onSaved={() => {
            setEditItem(null);
            load();
          }}
        />
      )}
      {viewItem && <ViewProjectModal project={viewItem} onClose={() => setViewItem(null)} />}
    </>
  );
}

function ProjectFormModal({
  title,
  project,
  employees,
  onClose,
  onSaved,
}: {
  title: string;
  project?: ProjectItem;
  employees: Employee[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(project?.name || '');
  const [startedOn, setStartedOn] = useState(project?.startedOn || '');
  // Stored/sent as the same comma-separated free-text string as before —
  // only the input widget changed to a multi-select of real employees.
  const [memberIds, setMemberIds] = useState<string[]>(() => {
    const names = (project?.members || '').split(',').map((n) => n.trim()).filter(Boolean);
    // Only match against non-archived employees — the multi-select below
    // only lists those, so matching against the full list here would pick
    // an id that has no corresponding <option>, silently dropping that
    // member the next time this project's members are edited and saved.
    return employees.filter((e) => !e.archiveType && names.includes(e.name)).map((e) => e.id);
  });
  // Any names from the saved project that don't match a current, non-archived
  // employee (renamed/removed employee, one since moved to Old/Temporary
  // Employees, or a name typed in before this was connected) are kept as-is
  // so editing a project never silently drops a member.
  const [extraMembers] = useState<string[]>(() => {
    const names = (project?.members || '').split(',').map((n) => n.trim()).filter(Boolean);
    const knownNames = new Set(employees.filter((e) => !e.archiveType).map((e) => e.name));
    return names.filter((n) => !knownNames.has(n));
  });
  const [tags, setTags] = useState(project?.tags || '');
  const [active, setActive] = useState(project?.active ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const memberNames = [
        ...employees.filter((e) => memberIds.includes(e.id)).map((e) => e.name),
        ...extraMembers,
      ];
      const payload = {
        name: name.trim(),
        startedOn: startedOn || undefined,
        members: memberNames.length > 0 ? memberNames.join(', ') : undefined,
        tags: tags || undefined,
        active,
      };
      if (project) {
        await api.patch(`/projects/${project.id}`, payload);
      } else {
        await api.post('/projects', payload);
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Project name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New branch setup" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Started on">
            <input className={inputClass} type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
          </Field>
          <Field label="Status">
            <label className="flex items-center gap-2 h-[38px]">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              <span className="text-sm text-ink">{active ? 'Active' : 'Inactive'}</span>
            </label>
          </Field>
        </div>
        <Field label="Member(s)">
          <select
            multiple
            className={`${inputClass} h-24`}
            value={memberIds}
            onChange={(e) => setMemberIds(Array.from(e.target.selectedOptions, (o) => o.value))}
          >
            {employees
              .filter((emp) => !emp.archiveType)
              .map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
          </select>
          {extraMembers.length > 0 && (
            <p className="text-xs text-muted mt-1">Also kept (not a current employee): {extraMembers.join(', ')}</p>
          )}
        </Field>
        <Field label="Tags (comma separated)">
          <input className={inputClass} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. urgent, demo" />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy || !name.trim()} requires="edit">{busy ? 'Saving…' : 'Save'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function ViewProjectModal({ project, onClose }: { project: ProjectItem; onClose: () => void }) {
  return (
    <Modal title="Project details" onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        <div>
          <div className="text-xs text-muted">Name</div>
          <div className="text-ink">{project.name}</div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-muted">Started on</div>
            <div className="text-ink">{formatDate(project.startedOn)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Status</div>
            <div className="text-ink">{project.active ? 'Active' : 'Inactive'}</div>
          </div>
        </div>
        <div>
          <div className="text-xs text-muted">Member(s)</div>
          <div className="text-ink">{project.members || '-'}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Tags</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {(project.tags || '')
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
              .map((t) => (
                <span key={t} className="text-[11px] px-2 py-0.5 rounded-full border border-brand-200 text-brand-700 bg-brand-50">
                  {t}
                </span>
              ))}
            {!project.tags && <span className="text-ink">-</span>}
          </div>
        </div>
      </div>
      <div className="flex justify-end pt-4">
        <SecondaryButton onClick={onClose}>Close</SecondaryButton>
      </div>
    </Modal>
  );
}

type LeaveStatus = 'pending' | 'approved' | 'canceled';

interface LeaveRequestItem {
  id: string;
  title?: string;
  staffName: string;
  shortDescription?: string;
  date: string;
  requestFrom: string;
  requestTo: string;
  leaves: number;
  status: LeaveStatus;
  manageBy?: string;
}

const LEAVE_STATUS_TONE: Record<LeaveStatus, string> = {
  pending: 'bg-amber-500 text-white',
  approved: 'bg-emerald-500 text-white',
  canceled: 'bg-red-500 text-white',
};
const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  canceled: 'Canceled',
};

// Inclusive day count between two "YYYY-MM-DD" dates.
function daySpan(from: string, to: string): number {
  if (!from || !to) return 1;
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
  return diff > 0 ? diff : 1;
}

function LeaveRequestTab({ employees }: { employees: Employee[] }) {
  const [requests, setRequests] = useState<LeaveRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<LeaveRequestItem | null>(null);

  function load() {
    setLoading(true);
    api.get('/leave-requests').then((res) => setRequests(res.data)).finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function onDelete(item: LeaveRequestItem) {
    if (!window.confirm(`Remove this leave request for "${item.staffName}"?`)) return;
    await api.delete(`/leave-requests/${item.id}`);
    load();
  }

  return (
    <>
      <PageHeader title="Leave Requests" subtitle="Manage employee absence applications and leave statuses." />

      <Card>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
          <h3 className="text-sm font-semibold text-brand-700">Requests</h3>
          <PrimaryButton icon={Plus} onClick={() => setShowAdd(true)} requires="edit">Add Leave Request</PrimaryButton>
        </div>
        {loading ? (
          <div className="p-4 text-sm text-muted">Loading…</div>
        ) : requests.length === 0 ? (
          <EmptyState>No leave requests yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid grid-cols-[45px_110px_110px_140px_100px_140px_70px_100px_120px_100px] px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wide bg-black/[0.02] min-w-[1100px]">
              <span>No.</span>
              <span>Title</span>
              <span>Staff Name</span>
              <span>Short Description</span>
              <span>Date</span>
              <span>Request For</span>
              <span>Leaves</span>
              <span>Status</span>
              <span>Leave Manage By</span>
              <span className="text-right">Action</span>
            </div>
            <div className="divide-y divide-black/5 min-w-[1100px]">
              {requests.map((r, i) => (
                <div key={r.id} className="grid grid-cols-[45px_110px_110px_140px_100px_140px_70px_100px_120px_100px] items-center px-4 py-3">
                  <span className="text-sm text-muted">{i + 1}.</span>
                  <span className="text-sm text-ink">{r.title || '-'}</span>
                  <span className="text-sm text-ink">{r.staffName}</span>
                  <span className="text-sm text-muted truncate pr-2">{r.shortDescription || '-'}</span>
                  <span className="text-sm text-muted">{formatDate(r.date)}</span>
                  <span className="text-xs text-muted">
                    From {formatDate(r.requestFrom)} to {formatDate(r.requestTo)}
                  </span>
                  <span className="text-sm text-ink">{r.leaves}</span>
                  <span>
                    <span className={`inline-block text-xs px-2.5 py-1 rounded-full font-semibold ${LEAVE_STATUS_TONE[r.status]}`}>
                      {LEAVE_STATUS_LABEL[r.status]}
                    </span>
                  </span>
                  <span className="text-sm text-muted">{r.manageBy || '-'}</span>
                  <div className="flex items-center justify-end gap-2">
                    <IconButton icon={Pencil} title="Edit" onClick={() => setEditItem(r)} requires="edit" />
                    <IconButton icon={Trash2} tone="danger" title="Remove" onClick={() => onDelete(r)} requires="full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {showAdd && (
        <LeaveRequestFormModal
          title="Add Leave Request"
          employees={employees}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
      {editItem && (
        <LeaveRequestFormModal
          title="Edit Leave Request"
          request={editItem}
          employees={employees}
          onClose={() => setEditItem(null)}
          onSaved={() => {
            setEditItem(null);
            load();
          }}
        />
      )}
    </>
  );
}

function LeaveRequestFormModal({
  title,
  request,
  employees,
  onClose,
  onSaved,
}: {
  title: string;
  request?: LeaveRequestItem;
  employees: Employee[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reqTitle, setReqTitle] = useState(request?.title || '');
  const [staffName, setStaffName] = useState(request?.staffName || '');
  const [shortDescription, setShortDescription] = useState(request?.shortDescription || '');
  const [requestFrom, setRequestFrom] = useState(request?.requestFrom || '');
  const [requestTo, setRequestTo] = useState(request?.requestTo || '');
  const [status, setStatus] = useState<LeaveStatus>(request?.status || 'pending');
  const [manageBy, setManageBy] = useState(request?.manageBy || 'administrator');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const leaves = daySpan(requestFrom, requestTo);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!staffName.trim() || !requestFrom || !requestTo) return;
    setBusy(true);
    setError('');
    try {
      const payload = {
        title: reqTitle || undefined,
        staffName: staffName.trim(),
        shortDescription: shortDescription || undefined,
        requestFrom,
        requestTo,
        leaves,
        status,
        manageBy: manageBy || undefined,
      };
      if (request) {
        await api.patch(`/leave-requests/${request.id}`, payload);
      } else {
        await api.post('/leave-requests', payload);
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title (optional)">
            <input className={inputClass} value={reqTitle} onChange={(e) => setReqTitle(e.target.value)} placeholder="e.g. Leave" />
          </Field>
          <Field label="Staff name">
            <select className={inputClass} value={staffName} onChange={(e) => setStaffName(e.target.value)} required>
              <option value="">Select employee</option>
              {/* Keep the request's current name selectable even if it doesn't
                  match a current, non-archived employee (renamed/deleted, or
                  since moved to Old/Temporary Employees). */}
              {!employees.some((e) => e.name === staffName && !e.archiveType) && staffName && (
                <option value={staffName}>{staffName}</option>
              )}
              {employees
                .filter((e) => !e.archiveType)
                .map((e) => (
                  <option key={e.id} value={e.name}>
                    {e.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Field label="Short description (optional)">
          <input className={inputClass} value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} placeholder="e.g. For urgent family matter" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="From">
            <input className={inputClass} type="date" value={requestFrom} onChange={(e) => setRequestFrom(e.target.value)} required />
          </Field>
          <Field label="To">
            <input className={inputClass} type="date" value={requestTo} onChange={(e) => setRequestTo(e.target.value)} required />
          </Field>
          <Field label="Leaves">
            <input className={inputClass} value={requestFrom && requestTo ? leaves : ''} readOnly placeholder="-" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as LeaveStatus)}>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="canceled">Canceled</option>
            </select>
          </Field>
          <Field label="Leave manage by">
            <input className={inputClass} value={manageBy} onChange={(e) => setManageBy(e.target.value)} placeholder="e.g. administrator" />
          </Field>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy || !staffName.trim() || !requestFrom || !requestTo} requires="edit">
            {busy ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

// Columns the Advance Export Dashboard can output. `get` pulls the value
// out of an attendance row (already resolved with its employee name).
// A few columns (IP, Location) aren't tracked by this system yet, so
// they always export blank — kept in the list so the output shape
// matches what the office may already expect, and they'll start filling
// in once/if that data is captured.
interface ReportRow extends AttendanceRecord {
  employeeNameResolved: string;
}

function weekdayName(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, { weekday: 'long' });
}

function workingHoursOf(checkIn?: string, checkOut?: string) {
  if (!checkIn || !checkOut) return '-';
  const [ih, im] = checkIn.split(':').map(Number);
  const [oh, om] = checkOut.split(':').map(Number);
  let minutes = oh * 60 + om - (ih * 60 + im);
  if (minutes < 0) minutes += 24 * 60;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const REPORT_COLUMNS: { key: string; label: string; get: (r: ReportRow) => string }[] = [
  { key: 'date', label: 'Date', get: (r) => r.date },
  { key: 'day', label: 'Day', get: (r) => weekdayName(r.date) },
  { key: 'name', label: 'Name', get: (r) => r.employeeNameResolved },
  { key: 'officeIn', label: 'Office In', get: (r) => r.checkIn || '' },
  { key: 'officeOut', label: 'Office Out', get: (r) => r.checkOut || '' },
  { key: 'lunchIn', label: 'Lunch In', get: (r) => r.lunchIn || '' },
  { key: 'lunchOut', label: 'Lunch Out', get: (r) => r.lunchOut || '' },
  { key: 'breakMinutes', label: 'Break', get: (r) => (r.breakMinutes != null ? `${r.breakMinutes}m` : '') },
  { key: 'workingHours', label: 'Working Hours', get: (r) => workingHoursOf(r.checkIn, r.checkOut) },
  { key: 'ip', label: 'IP', get: () => '' },
  { key: 'location', label: 'Location', get: () => '' },
  { key: 'lateReason', label: 'Late Reason', get: (r) => (r.status === 'late' ? r.notes || '' : '') },
  { key: 'punctuality', label: 'Punctuality', get: (r) => labelFor(ATTENDANCE_STATUS_OPTIONS, r.status) },
  { key: 'dailyReport', label: 'Daily Report', get: (r) => r.notes || '' },
];

function monthToRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${month}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const escape = (v: string) => `"${(v || '').replace(/"/g, '""')}"`;
  const csv = [header.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function AttendanceReportsTab({ employees, departments }: { employees: Employee[]; departments: DepartmentItem[] }) {
  const [staffId, setStaffId] = useState('');
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [dayFilter, setDayFilter] = useState('all');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showImport, setShowImport] = useState(false);

  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exportEmployeeIds, setExportEmployeeIds] = useState<string[]>([]);
  const [exportColumns, setExportColumns] = useState<Set<string>>(new Set(REPORT_COLUMNS.map((c) => c.key)));
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const [csvFrom, setCsvFrom] = useState('');
  const [csvTo, setCsvTo] = useState('');
  const [csvDownloading, setCsvDownloading] = useState(false);
  const [csvError, setCsvError] = useState('');

  function employeeName(id: string) {
    return employees.find((e) => e.id === id)?.name || id;
  }

  // Salary Status card — only meaningful once a single Staff Member is
  // selected and a report has been generated for them. Per day salary is
  // the employee's Base Salary (Employees tab) divided by the number of
  // calendar days in the selected month; Total Paid Salary is that times
  // how many days in the generated report came back Present/Late (a
  // Half day counts as 0.5, same convention as Payroll).
  const selectedEmployee = employees.find((e) => e.id === staffId);
  const monthlySalary = Number(selectedEmployee?.baseSalary) || 0;
  const totalCalendarDays = (() => {
    const [y, m] = month.split('-').map(Number);
    return y && m ? new Date(y, m, 0).getDate() : 30;
  })();
  const perDaySalary = totalCalendarDays ? monthlySalary / totalCalendarDays : 0;
  const totalAbsentDays = rows.filter((r) => r.status === 'absent').length;
  const totalPresentDays = rows.reduce((sum, r) => {
    if (r.status === 'present' || r.status === 'late') return sum + 1;
    if (r.status === 'half_day') return sum + 0.5;
    return sum;
  }, 0);
  const totalPaidSalary = perDaySalary * totalPresentDays;

  // OT pay — effective rate is the employee's own OT Rate Override
  // (Employees tab) if set, otherwise their department's Default OT
  // Rate (Department tab); either can be unset, in which case OT pay is 0.
  const departmentOtRate = departments.find((d) => d.name === selectedEmployee?.department)?.otRatePerHour;
  const effectiveOtRate = selectedEmployee?.otRatePerHour != null ? Number(selectedEmployee.otRatePerHour) : Number(departmentOtRate) || 0;
  const totalOtHours = rows.reduce((sum, r) => sum + (Number(r.overtimeHours) || 0), 0);
  const totalOtPay = totalOtHours * effectiveOtRate;
  const netPayableSalary = totalPaidSalary + totalOtPay;

  async function onDownloadCsvReport() {
    if (!csvFrom || !csvTo) {
      setCsvError('Pick a From and To date first.');
      return;
    }
    setCsvError('');
    setCsvDownloading(true);
    try {
      const res = await api.get('/attendance/report', { params: { from: csvFrom, to: csvTo, employeeId: staffId || undefined } });
      const data: ReportRow[] = (res.data as AttendanceRecord[]).map((r) => ({ ...r, employeeNameResolved: employeeName(r.employeeId) }));
      downloadCsv(
        `attendance-report-${csvFrom}-to-${csvTo}.csv`,
        REPORT_COLUMNS.map((c) => c.label),
        data.map((r) => REPORT_COLUMNS.map((c) => c.get(r))),
      );
    } catch (err: any) {
      setCsvError(err?.response?.data?.message || 'Could not download.');
    } finally {
      setCsvDownloading(false);
    }
  }

  async function onGenerate() {
    setGenerating(true);
    setHasGenerated(true);
    try {
      const { from, to } = monthToRange(month);
      const res = await api.get('/attendance/report', { params: { from, to, employeeId: staffId || undefined } });
      let data: AttendanceRecord[] = res.data;
      if (dayFilter !== 'all') data = data.filter((r) => r.status === dayFilter);
      setRows(data.map((r) => ({ ...r, employeeNameResolved: employeeName(r.employeeId) })));
      setExpanded(new Set());
    } finally {
      setGenerating(false);
    }
  }

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function downloadSample() {
    const header = REPORT_COLUMNS.map((c) => c.label);
    const sampleRows = [
      ['2026-09-01', 'Monday', 'Demo Staff', '08:02', '17:10', '', '', '', '9h 8m', '', '', '', 'Present', ''],
      ['2026-09-02', 'Tuesday', 'Demo Staff', '08:40', '17:05', '', '', '', '8h 25m', '', '', 'Traffic', 'Late', ''],
    ];
    downloadCsv('attendance-report-sample.csv', header, sampleRows);
  }

  function toggleExportColumn(key: string) {
    setExportColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectAllColumns() {
    setExportColumns((prev) => (prev.size === REPORT_COLUMNS.length ? new Set() : new Set(REPORT_COLUMNS.map((c) => c.key))));
  }

  async function onExportDataset() {
    if (!exportFrom || !exportTo) {
      setExportError('Pick a From and To date first.');
      return;
    }
    if (exportColumns.size === 0) {
      setExportError('Choose at least one column to output.');
      return;
    }
    setExportError('');
    setExporting(true);
    try {
      const ids = exportEmployeeIds.length > 0 ? exportEmployeeIds : [undefined];
      const results = await Promise.all(
        ids.map((id) => api.get('/attendance/report', { params: { from: exportFrom, to: exportTo, employeeId: id } })),
      );
      const merged: ReportRow[] = results
        .flatMap((res) => res.data as AttendanceRecord[])
        .map((r) => ({ ...r, employeeNameResolved: employeeName(r.employeeId) }));
      const columns = REPORT_COLUMNS.filter((c) => exportColumns.has(c.key));
      downloadCsv(
        `attendance-report-${exportFrom}-to-${exportTo}.csv`,
        columns.map((c) => c.label),
        merged.map((r) => columns.map((c) => c.get(r))),
      );
    } catch (err: any) {
      setExportError(err?.response?.data?.message || 'Could not export.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader title="Attendance Reports" subtitle="Generate, analyze, and export comprehensive staff time tracking logs." />

      <Card className="p-4 mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-56">
            <Field label="Staff Member">
              <select className={inputClass} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                <option value="">Select Staff member</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="w-full sm:w-56">
            <Field label="Date Range">
              <input className={inputClass} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
          </div>
          <div className="w-full sm:w-56">
            <Field label="Attendance Days">
              <select className={inputClass} value={dayFilter} onChange={(e) => setDayFilter(e.target.value)}>
                <option value="all">All Days</option>
                {ATTENDANCE_STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <PrimaryButton icon={FileText} onClick={onGenerate}>
              {generating ? 'Generating…' : 'Generate'}
            </PrimaryButton>
            <SecondaryButton icon={Upload} onClick={() => setShowImport(true)} requires="edit">Import</SecondaryButton>
            <SecondaryButton icon={Download} onClick={downloadSample}>Sample</SecondaryButton>
          </div>
        </div>
      </Card>

      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-black/10">
          <h3 className="text-sm font-semibold text-brand-700">Report Logs</h3>
          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton icon={ChevronsDown} onClick={() => setExpanded(new Set(rows.map((r) => r.id)))}>Expand All</SecondaryButton>
            <SecondaryButton icon={ChevronsUp} onClick={() => setExpanded(new Set())}>Collapse All</SecondaryButton>
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="grid grid-cols-[110px_1.2fr_90px_100px_100px_120px_90px_1fr] px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wide bg-black/[0.02] min-w-[900px]">
            <span>Date</span>
            <span>Name</span>
            <span>Day</span>
            <span>Office In</span>
            <span>Office Out</span>
            <span>Working Hours</span>
            <span>OT Hours</span>
            <span>Other Details</span>
          </div>
          <div className="divide-y divide-black/5 min-w-[900px]">
            {!hasGenerated ? (
              <div className="px-4 py-6 text-sm text-muted text-center max-w-[calc(100vw-2rem)] sm:max-w-none">Pick your filters and click Generate to load a report.</div>
            ) : generating ? (
              <div className="px-4 py-6 text-sm text-muted text-center max-w-[calc(100vw-2rem)] sm:max-w-none">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted text-center max-w-[calc(100vw-2rem)] sm:max-w-none">No data found</div>
            ) : (
              rows.map((r) => (
                <div key={r.id}>
                  <button
                    type="button"
                    onClick={() => toggleRow(r.id)}
                    className="w-full grid grid-cols-[110px_1.2fr_90px_100px_100px_120px_90px_1fr] items-center px-4 py-3 text-left hover:bg-black/[0.02]"
                  >
                    <span className="text-sm text-ink">{r.date}</span>
                    <span className="text-sm text-ink">{r.employeeNameResolved}</span>
                    <span className="text-sm text-muted">{weekdayName(r.date).slice(0, 3)}</span>
                    <span className="text-sm text-muted">{r.checkIn || '-'}</span>
                    <span className="text-sm text-muted">{r.checkOut || '-'}</span>
                    <span className="text-sm text-muted">{workingHoursOf(r.checkIn, r.checkOut)}</span>
                    <span className="text-sm text-muted">{Number(r.overtimeHours) > 0 ? `${Number(r.overtimeHours).toFixed(2)}h` : '-'}</span>
                    <span className="flex items-center gap-1.5 text-sm text-muted">
                      <ChevronDown size={14} className={`transition-transform ${expanded.has(r.id) ? 'rotate-180' : ''}`} />
                      {labelFor(ATTENDANCE_STATUS_OPTIONS, r.status)}
                    </span>
                  </button>
                  {expanded.has(r.id) && (
                    <div className="px-4 pb-3 -mt-1 text-xs text-muted grid grid-cols-2 gap-2 bg-black/[0.01]">
                      <span>Status: {labelFor(ATTENDANCE_STATUS_OPTIONS, r.status)}</span>
                      <span>Source: {r.source === 'device' ? 'Fingerprint device' : 'Manual entry'}</span>
                      <span>Overtime: {Number(r.overtimeHours) > 0 ? `${Number(r.overtimeHours).toFixed(2)}h` : '-'}</span>
                      <span>Notes: {r.notes || '-'}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
        {hasGenerated && rows.length > 0 && (
          <div className="px-4 py-3 text-xs text-muted border-t border-black/10">
            Showing 1 to {rows.length} of {rows.length} entries
          </div>
        )}
      </Card>

      {hasGenerated && staffId && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-ink mb-3">Salary Status</h3>
            <div className="divide-y divide-black/5 text-sm">
              <div className="flex items-center justify-between py-2 px-2 bg-black/[0.02] rounded-t">
                <span className="text-muted">Your Monthly Salary</span>
                <span className="font-medium text-ink">{monthlySalary.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between py-2 px-2">
                <span className="text-muted">Total Working days</span>
                <span className="font-medium text-ink">{totalCalendarDays} Days</span>
              </div>
              <div className="flex items-center justify-between py-2 px-2 bg-black/[0.02]">
                <span className="text-muted">Per day salary</span>
                <span className="font-medium text-ink">{perDaySalary.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between py-2 px-2">
                <span className="text-muted">Total absent days</span>
                <span className="font-medium text-ink">{totalAbsentDays} Days</span>
              </div>
              <div className="flex items-center justify-between py-2 px-2 bg-black/[0.02]">
                <span className="text-muted">Total present days</span>
                <span className="font-medium text-ink">{totalPresentDays} Days</span>
              </div>
              <div className="flex items-center justify-between py-2 px-2">
                <span>
                  Total Paid Salary as per total attendance [{perDaySalary.toFixed(0)} X {totalPresentDays}]
                </span>
                <span className="font-medium text-ink">{totalPaidSalary.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between py-2 px-2 bg-black/[0.02]">
                <span className="text-muted">
                  Total OT Hours {effectiveOtRate > 0 ? `(rate: ${effectiveOtRate.toFixed(2)}/hr)` : '(no OT rate set)'}
                </span>
                <span className="font-medium text-ink">{totalOtHours.toFixed(2)}h</span>
              </div>
              <div className="flex items-center justify-between py-2 px-2">
                <span className="text-muted">
                  Total OT Pay [{totalOtHours.toFixed(2)}h X {effectiveOtRate.toFixed(2)}]
                </span>
                <span className="font-medium text-ink">{totalOtPay.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between py-2.5 px-2 bg-brand-500 text-ink rounded-b font-semibold">
                <span>Net Payable Salary</span>
                <span>{netPayableSalary.toFixed(2)}</span>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <FileText size={16} className="text-ink/70" />
              <h3 className="text-sm font-semibold text-ink">Download CSV Report</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Field label="From">
                <input className={inputClass} type="date" value={csvFrom} onChange={(e) => setCsvFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <input className={inputClass} type="date" value={csvTo} onChange={(e) => setCsvTo(e.target.value)} />
              </Field>
            </div>
            {csvError && <p className="text-sm text-red-600 mb-2">{csvError}</p>}
            <div className="flex justify-end">
              <PrimaryButton icon={Download} onClick={onDownloadCsvReport} disabled={csvDownloading}>
                {csvDownloading ? 'Downloading…' : 'Download CSV'}
              </PrimaryButton>
            </div>
          </Card>
        </div>
      )}

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <FileText size={16} className="text-ink/70" />
          <h3 className="text-sm font-semibold text-ink">Advance Export Dashboard</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-5 h-5 rounded-full bg-brand-500 text-ink text-xs flex items-center justify-center font-semibold">1</span>
              <span className="text-sm font-medium text-ink">Parameters</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <Field label="From">
                <input className={inputClass} type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <input className={inputClass} type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} />
              </Field>
            </div>
            <Field label="Target Employees">
              <select
                multiple
                className={`${inputClass} h-24`}
                value={exportEmployeeIds}
                onChange={(e) => setExportEmployeeIds(Array.from(e.target.selectedOptions, (o) => o.value))}
              >
                {/* Includes archived (Old/Temporary) employees on purpose —
                    this is a historical export, so someone who has since
                    left should still be selectable. */}
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-xs text-muted mt-1">
              {exportEmployeeIds.length === 0 ? 'None selected — all employees will be included.' : `${exportEmployeeIds.length} selected`}
            </p>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-5 h-5 rounded-full bg-brand-500 text-ink text-xs flex items-center justify-center font-semibold">2</span>
              <span className="text-sm font-medium text-ink">Choose Columns to Output</span>
            </div>
            <label className="flex items-center gap-2 text-sm text-brand-700 font-medium mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={exportColumns.size === REPORT_COLUMNS.length}
                onChange={toggleSelectAllColumns}
              />
              Select All
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
              {REPORT_COLUMNS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm text-ink/80 cursor-pointer">
                  <input type="checkbox" checked={exportColumns.has(c.key)} onChange={() => toggleExportColumn(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {exportError && <p className="text-sm text-red-600 mt-3">{exportError}</p>}
        <div className="flex justify-end pt-4 border-t border-black/10 mt-4">
          <PrimaryButton icon={Download} onClick={onExportDataset} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export Dataset'}
          </PrimaryButton>
        </div>
      </Card>

      {showImport && (
        <Modal title="Import Attendance" onClose={() => setShowImport(false)}>
          <p className="text-sm text-muted">
            CSV import isn't wired up yet — this button is a placeholder for when that's ready. For now, attendance comes in
            through Mark Attendance or a connected fingerprint device.
          </p>
          <div className="flex justify-end pt-4">
            <SecondaryButton onClick={() => setShowImport(false)}>Close</SecondaryButton>
          </div>
        </Modal>
      )}
    </>
  );
}

interface PayrollRow {
  id: string;
  employeeId: string | null;
  staffName: string;
  periodFrom: string;
  periodTo: string;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  workingHours: number;
  otHours: number;
  otRate: number;
  otPay: number;
  staffSalary: number;
  allowances: number;
  status: 'draft' | 'approved' | 'paying' | 'paid';
  periodDays: number;
  employedDays: number;
  unpaidDays: number;
  grossPay: number;
  absenceDeduction: number;
  socialProtectionCovered: boolean;
  spfEmployee: number;
  spfEmployer: number;
  advanceRecovery: number;
  salaryPaidBy: string | null;
  calculatedSalary: number;
  createdAt: string;
  isPaid: boolean;
  paidDate: string | null;
}
interface PayrollBankAccount {
  id: string;
  name: string;
  currentBalance: number | string;
}
interface PayrollDocument {
  id: string;
  payrollId: string;
  label: string;
  originalName: string;
  filePath: string;
  uploadedAt: string;
}

const m3 = (n: number | string | null | undefined) => Number(n || 0).toFixed(3);

function payrollStatusOf(r: PayrollRow): 'draft' | 'approved' | 'paid' {
  if (r.isPaid || r.status === 'paid') return 'paid';
  if (r.status === 'approved' || r.status === 'paying') return 'approved';
  return 'draft';
}

const PAYROLL_STATUS_STYLE: Record<string, string> = {
  draft: 'bg-black/5 text-ink/70',
  approved: 'bg-amber-50 text-amber-700',
  paid: 'bg-brand-50 text-brand-700',
};

const PAYROLL_PAGE_SIZE_OPTIONS = [10, 25, 50];

function PayrollTab({ employees }: { employees: Employee[] }) {
  // payroll runs per calendar month
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const range = monthToRange(month);
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [editItem, setEditItem] = useState<PayrollRow | null>(null);
  const [payingItem, setPayingItem] = useState<PayrollRow | null>(null);
  const [docsItem, setDocsItem] = useState<PayrollRow | null>(null);
  const [bankAccounts, setBankAccounts] = useState<PayrollBankAccount[]>([]);
  // Salary Advance lives as a sub-view of this tab (both pay employees money).
  const [subView, setSubView] = useState<'payroll' | 'salary-advance'>('payroll');

  function load() {
    setLoading(true);
    api.get('/payroll').then((res) => setRows(res.data)).finally(() => setLoading(false));
  }

  useEffect(load, []);
  useEffect(() => {
    api.get('/bank-accounts').then((res) => setBankAccounts(res.data));
  }, []);
  useEffect(() => setPage(1), [search, pageSize, month]);
  void employees;

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError('');
    try {
      await fn();
      load();
    } catch (err: any) {
      const m = err?.response?.data?.message;
      setError(Array.isArray(m) ? m.join(' ') : m || 'Something went wrong.');
    } finally {
      setBusy('');
    }
  }

  async function onDelete(row: PayrollRow) {
    if (!window.confirm(`Remove the draft payroll row for "${row.staffName}"?`)) return;
    run(`del:${row.id}`, () => api.delete(`/payroll/${row.id}`));
  }

  const monthRows = rows.filter((r) => r.periodFrom === range.from && r.periodTo === range.to);
  const searchTerm = search.trim().toLowerCase();
  const filtered = searchTerm ? monthRows.filter((r) => r.staffName.toLowerCase().includes(searchTerm)) : monthRows;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const drafts = monthRows.filter((r) => payrollStatusOf(r) === 'draft').length;
  const totals = monthRows.reduce(
    (t, r) => ({
      gross: t.gross + Number(r.grossPay) - Number(r.absenceDeduction) + Number(r.otPay),
      spf: t.spf + Number(r.spfEmployee) + Number(r.spfEmployer),
      net: t.net + Number(r.calculatedSalary),
    }),
    { gross: 0, spf: 0, net: 0 },
  );
  const cols = 'grid-cols-[32px_minmax(140px,1.2fr)_50px_50px_80px_75px_65px_75px_75px_90px_75px_180px]';

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        {(
          [
            { value: 'payroll', label: 'Payroll' },
            { value: 'salary-advance', label: 'Salary Advance' },
          ] as const
        ).map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setSubView(o.value)}
            className={`text-sm font-medium px-3 py-1.5 rounded-lg border transition-colors ${
              subView === o.value ? 'bg-brand-500 border-brand-500 text-ink' : 'bg-white border-black/10 text-ink/70 hover:bg-black/5'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {subView === 'salary-advance' ? (
        <SalaryAdvance />
      ) : (
        <>
          <PageHeader title="Pay Roll" subtitle="Monthly salaries: generate, check, approve (books the cost), then pay." />

          <Card className="p-4 mb-5">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-52">
                <Field label="Month">
                  <input className={inputClass} type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
                </Field>
              </div>
              <PrimaryButton
                icon={FileText}
                onClick={() => run('generate', () => api.post('/payroll/generate', range))}
                disabled={!!busy}
                requires="edit"
              >
                {busy === 'generate' ? 'Generating…' : 'Generate'}
              </PrimaryButton>
              {drafts > 0 && (
                <SecondaryButton
                  onClick={() => {
                    if (window.confirm(`Approve ${drafts} draft row(s) for ${month}? This books the salary cost in the accounts.`)) {
                      run('approveAll', () => api.post('/payroll/approve', range));
                    }
                  }}
                  disabled={!!busy}
                  requires="edit"
                >
                  {busy === 'approveAll' ? 'Approving…' : `Approve all drafts (${drafts})`}
                </SecondaryButton>
              )}
            </div>
            <p className="mt-2 text-xs text-muted">
              Full monthly salary (basic + allowances); only absent days are deducted (monthly ÷ 30 per day), approved leave is paid. Joiners and leavers
              are paid for their days. Social Protection (Omani staff) and salary advance installments are deducted.
            </p>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </Card>

          {monthRows.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <Card className="p-3"><div className="text-xs text-muted">Salary cost (earned + OT)</div><div className="text-lg font-semibold text-ink">{m3(totals.gross)} OMR</div></Card>
              <Card className="p-3"><div className="text-xs text-muted">Social Protection (employee + employer)</div><div className="text-lg font-semibold text-ink">{m3(totals.spf)} OMR</div></Card>
              <Card className="p-3"><div className="text-xs text-muted">Net pay</div><div className="text-lg font-semibold text-brand-700">{m3(totals.net)} OMR</div></Card>
            </div>
          )}

          <Card>
            <div className="px-4 py-3 border-b border-black/10">
              <h3 className="text-sm font-semibold text-brand-700">Salary Pay Roll - {month}</h3>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-black/10 text-sm">
              <label className="flex items-center gap-2 text-muted">
                Show
                <select className="rounded-lg border border-black/15 px-2 py-1 text-sm" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                  {PAYROLL_PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                entries
              </label>
              <div className="relative w-full sm:w-56">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <input className={`${inputClass} pl-8`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" />
              </div>
            </div>

            {loading ? (
              <div className="p-4 text-sm text-muted">Loading…</div>
            ) : filtered.length === 0 ? (
              <EmptyState>{monthRows.length === 0 ? `No payroll for ${month} yet - click Generate.` : `No rows match "${search}".`}</EmptyState>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <div className={`grid ${cols} px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wide bg-black/[0.02] min-w-[1040px]`}>
                    <span>No.</span>
                    <span>Staff Name</span>
                    <span>Days</span>
                    <span>Unpaid</span>
                    <span className="text-right">Gross</span>
                    <span className="text-right">Absence</span>
                    <span className="text-right">OT</span>
                    <span className="text-right">SPF</span>
                    <span className="text-right">Advance</span>
                    <span className="text-right">Net Pay</span>
                    <span className="text-center">Status</span>
                    <span className="text-right">Actions</span>
                  </div>
                  <div className="divide-y divide-black/5 min-w-[1040px]">
                    {paged.map((r, i) => {
                      const st = payrollStatusOf(r);
                      return (
                        <div key={r.id} className={`grid ${cols} items-center px-4 py-3`}>
                          <span className="text-sm text-muted">{(currentPage - 1) * pageSize + i + 1}.</span>
                          <span className="text-sm text-ink truncate pr-2" title={`Basic ${m3(r.staffSalary)} + allowances ${m3(r.allowances)} a month`}>
                            {r.staffName}
                            {r.socialProtectionCovered && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">SPF</span>}
                          </span>
                          <span className="text-sm text-muted">
                            {Number(r.employedDays || 0)}/{r.periodDays || '-'}
                          </span>
                          <span className="text-sm text-muted">{Number(r.unpaidDays || 0)}</span>
                          <span className="text-sm text-ink text-right">{m3(r.grossPay)}</span>
                          <span className="text-sm text-muted text-right">{Number(r.absenceDeduction) ? `-${m3(r.absenceDeduction)}` : '-'}</span>
                          <span className="text-sm text-muted text-right" title={`${Number(r.otHours).toFixed(2)}h × ${m3(r.otRate)}/hr`}>
                            {Number(r.otPay) ? m3(r.otPay) : '-'}
                          </span>
                          <span className="text-sm text-muted text-right" title={`Employer share ${m3(r.spfEmployer)}`}>
                            {Number(r.spfEmployee) ? `-${m3(r.spfEmployee)}` : '-'}
                          </span>
                          <span className="text-sm text-muted text-right">{Number(r.advanceRecovery) ? `-${m3(r.advanceRecovery)}` : '-'}</span>
                          <span className="text-sm font-semibold text-brand-700 text-right">{m3(r.calculatedSalary)}</span>
                          <span className="text-center">
                            <span className={`text-xs px-2 py-1 rounded-full font-medium capitalize ${PAYROLL_STATUS_STYLE[st]}`} title={r.paidDate ? `Paid on ${r.paidDate}` : undefined}>
                              {st}
                            </span>
                          </span>
                          <div className="flex items-center justify-end gap-2">
                            {st === 'draft' && (
                              <>
                                <SecondaryButton onClick={() => run(`ap:${r.id}`, () => api.post(`/payroll/${r.id}/approve`))} disabled={!!busy} requires="edit">
                                  {busy === `ap:${r.id}` ? '…' : 'Approve'}
                                </SecondaryButton>
                                <IconButton icon={Pencil} title="Edit" onClick={() => setEditItem(r)} requires="edit" />
                                <IconButton icon={Trash2} tone="danger" title="Remove" onClick={() => onDelete(r)} requires="full" />
                              </>
                            )}
                            {st === 'approved' && (
                              <>
                                <PrimaryButton onClick={() => setPayingItem(r)} disabled={!!busy} requires="edit">
                                  Pay
                                </PrimaryButton>
                                <SecondaryButton
                                  onClick={() => {
                                    if (window.confirm('Move back to draft? This removes its salary entry from the books.')) {
                                      run(`un:${r.id}`, () => api.post(`/payroll/${r.id}/unapprove`));
                                    }
                                  }}
                                  disabled={!!busy}
                                  requires="edit"
                                >
                                  Undo
                                </SecondaryButton>
                              </>
                            )}
                            {st === 'paid' && (
                              <>
                                <span className="text-xs text-muted">{r.paidDate ? `Paid ${formatDate(r.paidDate)}` : ''}</span>
                                <IconButton icon={FileText} title="Payment documents" onClick={() => setDocsItem(r)} />
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center justify-between px-4 py-3 text-xs text-muted">
                  <span>
                    Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} entries
                  </span>
                  <div className="flex items-center gap-1">
                    <SecondaryButton onClick={() => setPage(Math.max(1, currentPage - 1))} className={currentPage === 1 ? 'opacity-50' : ''}>
                      Previous
                    </SecondaryButton>
                    {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setPage(n)}
                        className={`w-8 h-8 rounded-lg text-xs font-medium border ${
                          n === currentPage ? 'bg-brand-500 border-brand-500 text-ink' : 'bg-white border-black/10 text-ink/70 hover:bg-black/5'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                    <SecondaryButton onClick={() => setPage(Math.min(totalPages, currentPage + 1))} className={currentPage === totalPages ? 'opacity-50' : ''}>
                      Next
                    </SecondaryButton>
                  </div>
                </div>
              </>
            )}
          </Card>

          {editItem && (
            <PayrollEditModal
              row={editItem}
              onClose={() => setEditItem(null)}
              onSaved={() => {
                setEditItem(null);
                load();
              }}
            />
          )}
          {payingItem && (
            <PayrollMarkPaidModal
              row={payingItem}
              bankAccounts={bankAccounts}
              onClose={() => setPayingItem(null)}
              onSaved={() => {
                setPayingItem(null);
                load();
              }}
            />
          )}
          {docsItem && <PayrollDocumentsModal row={docsItem} onClose={() => setDocsItem(null)} />}
        </>
      )}
    </>
  );
}

// Payment-proof documents (bank transfer receipt, cash voucher, ...)
// attached to a payroll row once it's Paid. Mirrors EmployeeDocumentsModal,
// plus a Rename ("Edit") step CompanyDocumentsModal-style since the file
// itself is never swapped in place.
function PayrollDocumentsModal({ row, onClose }: { row: PayrollRow; onClose: () => void }) {
  const [docs, setDocs] = useState<PayrollDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingDoc, setEditingDoc] = useState<PayrollDocument | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function load() {
    setLoading(true);
    api.get(`/payroll/${row.id}/documents`).then((res) => setDocs(res.data)).finally(() => setLoading(false));
  }

  useEffect(load, [row.id]);

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (!file || !label.trim()) return;
    setBusy(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('label', label.trim());
      await api.post(`/payroll/${row.id}/documents`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setLabel('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not upload the document.');
    } finally {
      setBusy(false);
    }
  }

  async function onView(docId: string) {
    await viewFile(`/payroll/${row.id}/documents/${docId}`);
  }

  async function onDelete(docId: string) {
    if (!window.confirm('Remove this document? This cannot be undone.')) return;
    await api.delete(`/payroll/${row.id}/documents/${docId}`);
    load();
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingDoc || !editLabel.trim()) return;
    setSavingEdit(true);
    try {
      await api.patch(`/payroll/${row.id}/documents/${editingDoc.id}`, { label: editLabel.trim() });
      setEditingDoc(null);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not rename this document.');
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <Modal title={`Payment documents — ${row.staffName}`} onClose={onClose} wide>
      <Can>
      <form onSubmit={onUpload} className="flex items-end gap-2 mb-3">
        <div className="flex-1">
          <Field label="Document type">
            <input
              className={inputClass}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Bank Transfer Receipt"
            />
          </Field>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <SecondaryButton icon={Upload} onClick={() => fileInputRef.current?.click()}>
            {file ? file.name.slice(0, 18) : 'Choose file'}
          </SecondaryButton>
        </div>
        <PrimaryButton type="submit" disabled={busy || !file || !label.trim()} requires="edit">
          {busy ? 'Uploading…' : 'Add'}
        </PrimaryButton>
      </form>
      </Can>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-muted">No payment documents attached yet.</p>
      ) : (
        <div className="divide-y divide-black/5 border border-black/10 rounded-lg">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between px-3 py-2">
              <div>
                <div className="text-sm text-ink">{d.label}</div>
                <div className="text-xs text-muted">
                  {d.originalName} · {new Date(d.uploadedAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <IconButton icon={Eye} title="View" onClick={() => onView(d.id)} />
                <IconButton
                  icon={Pencil}
                  title="Rename"
                  onClick={() => {
                    setEditingDoc(d);
                    setEditLabel(d.label);
                  }}
                  requires="edit"
                />
                <IconButton icon={Trash2} tone="danger" title="Remove" onClick={() => onDelete(d.id)} requires="full" />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end pt-3">
        <SecondaryButton onClick={onClose}>Close</SecondaryButton>
      </div>

      {editingDoc && (
        <Modal title="Rename document" onClose={() => setEditingDoc(null)}>
          <form onSubmit={saveEdit} className="space-y-3">
            <Field label="Document type">
              <input className={inputClass} value={editLabel} onChange={(e) => setEditLabel(e.target.value)} required />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <SecondaryButton onClick={() => setEditingDoc(null)}>Cancel</SecondaryButton>
              <PrimaryButton type="submit" disabled={savingEdit} requires="edit">
                {savingEdit ? 'Saving…' : 'Save'}
              </PrimaryButton>
            </div>
          </form>
        </Modal>
      )}
    </Modal>
  );
}

// Payroll "Mark Paid" — the one place salary actually leaves the
// business. Mirrors Accounting.tsx's Reimbursement MarkPaidModal.
function PayslipLines({ row }: { row: PayrollRow }) {
  const lines: [string, string][] = [
    [`Basic + allowances (${Number(row.employedDays || 0)} of ${row.periodDays || '-'} days)`, m3(row.grossPay)],
  ];
  if (Number(row.absenceDeduction)) lines.push([`Absence (${Number(row.unpaidDays)} unpaid day(s))`, `-${m3(row.absenceDeduction)}`]);
  if (Number(row.otPay)) lines.push([`Overtime (${Number(row.otHours).toFixed(2)}h)`, m3(row.otPay)]);
  if (Number(row.spfEmployee)) lines.push(['Social Protection Fund (employee share)', `-${m3(row.spfEmployee)}`]);
  if (Number(row.advanceRecovery)) lines.push(['Salary advance installment', `-${m3(row.advanceRecovery)}`]);
  return (
    <div className="text-sm bg-black/[0.03] rounded-lg p-3 space-y-1">
      {lines.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3">
          <span className="text-ink/70">{k}</span>
          <span className="text-ink">{v}</span>
        </div>
      ))}
      <div className="flex justify-between gap-3 border-t border-black/10 pt-1 font-semibold">
        <span>Net pay</span>
        <span className="text-brand-700">{m3(row.calculatedSalary)} OMR</span>
      </div>
    </div>
  );
}

function PayrollMarkPaidModal({
  row,
  bankAccounts,
  onClose,
  onSaved,
}: {
  row: PayrollRow;
  bankAccounts: PayrollBankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [bankAccountId, setBankAccountId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/payroll/${row.id}/pay`, { bankAccountId });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not mark this salary as paid.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Pay salary — ${row.staffName}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="text-xs text-muted">
          {formatDate(row.periodFrom)} – {formatDate(row.periodTo)}
        </div>
        <PayslipLines row={row} />
        <BankAccountSelect label="Paid from account" value={bankAccountId} onChange={setBankAccountId} accounts={bankAccounts as any} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy} requires="edit">
            {busy ? 'Saving…' : 'Confirm payment'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function PayrollEditModal({ row, onClose, onSaved }: { row: PayrollRow; onClose: () => void; onSaved: () => void }) {
  const [staffSalary, setStaffSalary] = useState(String(row.staffSalary ?? 0));
  const [allowances, setAllowances] = useState(String(row.allowances ?? 0));
  const [unpaidDays, setUnpaidDays] = useState(String(row.unpaidDays ?? 0));
  const [salaryPaidBy, setSalaryPaidBy] = useState(row.salaryPaidBy || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.patch(`/payroll/${row.id}`, {
        staffSalary: Number(staffSalary) || 0,
        allowances: Number(allowances) || 0,
        unpaidDays: Number(unpaidDays) || 0,
        salaryPaidBy: salaryPaidBy || undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Edit Salary — ${row.staffName}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <PayslipLines row={row} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Basic (monthly)">
            <input className={inputClass} type="number" min="0" step="0.001" value={staffSalary} onChange={(e) => setStaffSalary(e.target.value)} />
          </Field>
          <Field label="Allowances (monthly)">
            <input className={inputClass} type="number" min="0" step="0.001" value={allowances} onChange={(e) => setAllowances(e.target.value)} />
          </Field>
          <Field label="Unpaid days">
            <input className={inputClass} type="number" min="0" step="0.5" value={unpaidDays} onChange={(e) => setUnpaidDays(e.target.value)} />
          </Field>
        </div>
        <Field label="Salary Paid By (note)">
          <input className={inputClass} value={salaryPaidBy} onChange={(e) => setSalaryPaidBy(e.target.value)} placeholder="e.g. Bank Transfer, Accounts" />
        </Field>
        <p className="text-xs text-muted">Net pay is recalculated when you save. Changes here apply to this month only - edit the employee for the future.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy} requires="edit">
            {busy ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

interface EventItem {
  id: string;
  name: string;
  description?: string;
  date: string;
  time?: string;
  active: boolean;
  createdAt: string;
}

function EventTab() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<EventItem | null>(null);
  const [showImport, setShowImport] = useState(false);

  function load() {
    setLoading(true);
    api.get('/events').then((res) => setEvents(res.data)).finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function onDelete(item: EventItem) {
    if (!window.confirm(`Remove the "${item.name}" event?`)) return;
    await api.delete(`/events/${item.id}`);
    load();
  }

  function onExport() {
    const header = ['Name', 'Description', 'Date', 'Time', 'Status'];
    const rows = events.map((e) => [e.name, e.description || '', e.date, e.time || '', e.active ? 'Active' : 'Inactive']);
    downloadCsv('events.csv', header, rows);
  }

  return (
    <>
      <PageHeader title="Events" subtitle="Plan, schedule, and track upcoming company milestones and employee events." />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-black/10">
          <h3 className="text-sm font-semibold text-brand-700">Active Events Log</h3>
          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton icon={Upload} onClick={() => setShowImport(true)} requires="edit">Import</SecondaryButton>
            <SecondaryButton icon={Download} onClick={onExport}>Export</SecondaryButton>
            <PrimaryButton icon={Plus} onClick={() => setShowAdd(true)} requires="edit">Add Event</PrimaryButton>
          </div>
        </div>

        {loading ? (
          <div className="p-4 text-sm text-muted">Loading…</div>
        ) : events.length === 0 ? (
          <EmptyState>No events added yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid grid-cols-[50px_1.3fr_1.6fr_130px_100px_100px_120px] px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wide bg-black/[0.02] min-w-[960px]">
              <span>No.</span>
              <span>Name</span>
              <span>Description</span>
              <span>Date</span>
              <span>Time</span>
              <span>Status</span>
              <span className="text-right">Action</span>
            </div>
            <div className="divide-y divide-black/5 min-w-[960px]">
              {events.map((e, i) => (
                <div key={e.id} className="grid grid-cols-[50px_1.3fr_1.6fr_130px_100px_100px_120px] items-center px-4 py-3">
                  <span className="text-sm text-muted">{i + 1}.</span>
                  <span className="text-sm font-medium text-ink truncate pr-2">{e.name}</span>
                  <span className="text-sm text-muted truncate pr-2">{e.description || '-'}</span>
                  <span>
                    <span className="inline-block text-xs px-2 py-1 rounded-md border border-black/10 text-ink/70">
                      {formatDate(e.date)}
                    </span>
                  </span>
                  <span className="text-sm text-muted">{e.time || '-'}</span>
                  <span
                    className={`inline-block w-fit text-xs px-2 py-1 rounded-full font-medium ${
                      e.active ? 'bg-brand-50 text-brand-700' : 'bg-black/5 text-ink/60'
                    }`}
                  >
                    {e.active ? 'Active' : 'Inactive'}
                  </span>
                  <div className="flex items-center justify-end gap-2">
                    <IconButton icon={Pencil} title="Edit" onClick={() => setEditItem(e)} requires="edit" />
                    <IconButton icon={Trash2} tone="danger" title="Remove" onClick={() => onDelete(e)} requires="full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {showAdd && (
        <EventFormModal
          title="Add Event"
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
      {editItem && (
        <EventFormModal
          title="Edit Event"
          event={editItem}
          onClose={() => setEditItem(null)}
          onSaved={() => {
            setEditItem(null);
            load();
          }}
        />
      )}
      {showImport && (
        <Modal title="Import Events" onClose={() => setShowImport(false)}>
          <p className="text-sm text-muted">
            CSV import isn't wired up yet — this button is a placeholder for when that's ready. For now, add events one at
            a time with "Add Event".
          </p>
          <div className="flex justify-end pt-4">
            <SecondaryButton onClick={() => setShowImport(false)}>Close</SecondaryButton>
          </div>
        </Modal>
      )}
    </>
  );
}

function EventFormModal({
  title,
  event,
  onClose,
  onSaved,
}: {
  title: string;
  event?: EventItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(event?.name || '');
  const [description, setDescription] = useState(event?.description || '');
  const [date, setDate] = useState(event?.date || todayStr());
  const [time, setTime] = useState(event?.time || '');
  const [active, setActive] = useState(event?.active ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !date) return;
    setBusy(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        description: description || undefined,
        date,
        time: time || undefined,
        active,
      };
      if (event) {
        await api.patch(`/events/${event.id}`, payload);
      } else {
        await api.post('/events', payload);
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Description">
          <textarea
            className={inputClass}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Time">
            <input
              className={inputClass}
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="e.g. 9:00 PM"
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink/80 cursor-pointer">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy} requires="edit">
            {busy ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

interface NoticeItem {
  id: string;
  title: string;
  date: string;
  description?: string;
  active: boolean;
  createdAt: string;
}

function NoticeTab() {
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<NoticeItem | null>(null);

  function load() {
    setLoading(true);
    api.get('/notices').then((res) => setNotices(res.data)).finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function onDelete(item: NoticeItem) {
    if (!window.confirm(`Remove the "${item.title}" notice?`)) return;
    await api.delete(`/notices/${item.id}`);
    load();
  }

  return (
    <>
      <PageHeader title="Notices" subtitle="Publish company-wide broadcasts, policy updates, and staff announcements." />

      <Card>
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10">
          <h3 className="text-sm font-semibold text-brand-700">Broadcast History</h3>
          <PrimaryButton icon={Plus} onClick={() => setShowAdd(true)} requires="edit">Add Notice</PrimaryButton>
        </div>

        {loading ? (
          <div className="p-4 text-sm text-muted">Loading…</div>
        ) : notices.length === 0 ? (
          <EmptyState>No notices published yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid grid-cols-[50px_1.3fr_130px_2fr_100px_120px] px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wide bg-black/[0.02] min-w-[780px]">
              <span>No.</span>
              <span>Title</span>
              <span>Date</span>
              <span>Description</span>
              <span>Status</span>
              <span className="text-right">Action</span>
            </div>
            <div className="divide-y divide-black/5 min-w-[780px]">
              {notices.map((n, i) => (
                <div key={n.id} className="grid grid-cols-[50px_1.3fr_130px_2fr_100px_120px] items-center px-4 py-3">
                  <span className="text-sm text-muted">{i + 1}.</span>
                  <span className="text-sm font-medium text-ink truncate pr-2">{n.title}</span>
                  <span>
                    <span className="inline-block text-xs px-2 py-1 rounded-md border border-black/10 text-ink/70">
                      {formatDate(n.date)}
                    </span>
                  </span>
                  <span className="text-sm text-muted truncate pr-2">{n.description || '-'}</span>
                  <span
                    className={`inline-block w-fit text-xs px-2 py-1 rounded-full font-medium ${
                      n.active ? 'bg-brand-50 text-brand-700' : 'bg-black/5 text-ink/60'
                    }`}
                  >
                    {n.active ? 'Active' : 'Inactive'}
                  </span>
                  <div className="flex items-center justify-end gap-2">
                    <IconButton icon={Pencil} title="Edit" onClick={() => setEditItem(n)} requires="edit" />
                    <IconButton icon={Trash2} tone="danger" title="Remove" onClick={() => onDelete(n)} requires="full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {showAdd && (
        <NoticeFormModal
          title="Add Notice"
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
      {editItem && (
        <NoticeFormModal
          title="Edit Notice"
          notice={editItem}
          onClose={() => setEditItem(null)}
          onSaved={() => {
            setEditItem(null);
            load();
          }}
        />
      )}
    </>
  );
}

function NoticeFormModal({
  title,
  notice,
  onClose,
  onSaved,
}: {
  title: string;
  notice?: NoticeItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [noticeTitle, setNoticeTitle] = useState(notice?.title || '');
  const [date, setDate] = useState(notice?.date || todayStr());
  const [description, setDescription] = useState(notice?.description || '');
  const [active, setActive] = useState(notice?.active ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!noticeTitle.trim() || !date) return;
    setBusy(true);
    setError('');
    try {
      const payload = {
        title: noticeTitle.trim(),
        date,
        description: description || undefined,
        active,
      };
      if (notice) {
        await api.patch(`/notices/${notice.id}`, payload);
      } else {
        await api.post('/notices', payload);
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Title">
          <input className={inputClass} value={noticeTitle} onChange={(e) => setNoticeTitle(e.target.value)} required />
        </Field>
        <Field label="Date">
          <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Description">
          <textarea
            className={inputClass}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink/80 cursor-pointer">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy} requires="edit">
            {busy ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

interface HolidayItem {
  id: string;
  name: string;
  dateFrom: string;
  dateTo: string;
  days: number;
  active: boolean;
  createdAt: string;
}

function HolidayTab() {
  const [holidays, setHolidays] = useState<HolidayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<HolidayItem | null>(null);
  const [showImport, setShowImport] = useState(false);

  function load() {
    setLoading(true);
    api.get('/holidays').then((res) => setHolidays(res.data)).finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function onDelete(item: HolidayItem) {
    if (!window.confirm(`Remove the "${item.name}" holiday?`)) return;
    await api.delete(`/holidays/${item.id}`);
    load();
  }

  function onExport() {
    const header = ['Name', 'From', 'To', 'Days', 'Status'];
    const rows = holidays.map((h) => [h.name, h.dateFrom, h.dateTo, String(h.days), h.active ? 'Active' : 'Inactive']);
    downloadCsv('holidays.csv', header, rows);
  }

  return (
    <>
      <PageHeader title="Holidays" subtitle="Track official non-working days, festival vacations, and organizational leaves." />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-black/10">
          <h3 className="text-sm font-semibold text-brand-700">Scheduled Holidays</h3>
          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton icon={Upload} onClick={() => setShowImport(true)} requires="edit">Import</SecondaryButton>
            <SecondaryButton icon={Download} onClick={onExport}>Export</SecondaryButton>
            <PrimaryButton icon={Plus} onClick={() => setShowAdd(true)} requires="edit">Add Holiday</PrimaryButton>
          </div>
        </div>

        {loading ? (
          <div className="p-4 text-sm text-muted">Loading…</div>
        ) : holidays.length === 0 ? (
          <EmptyState>No holidays scheduled yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid grid-cols-[50px_1.2fr_2fr_100px_100px_120px] px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wide bg-black/[0.02] min-w-[860px]">
              <span>No.</span>
              <span>Name</span>
              <span>Date(s)</span>
              <span>Days</span>
              <span>Status</span>
              <span className="text-right">Action</span>
            </div>
            <div className="divide-y divide-black/5 min-w-[860px]">
              {holidays.map((h, i) => (
                <div key={h.id} className="grid grid-cols-[50px_1.2fr_2fr_100px_100px_120px] items-center px-4 py-3">
                  <span className="text-sm text-muted">{i + 1}.</span>
                  <span className="text-sm font-medium text-ink truncate pr-2">{h.name}</span>
                  <span>
                    <span className="inline-block text-xs px-2 py-1 rounded-md border border-black/10 text-ink/70">
                      From {formatDate(h.dateFrom)} to {formatDate(h.dateTo)}
                    </span>
                  </span>
                  <span>
                    <span className="inline-block text-xs px-2 py-1 rounded-md border border-black/10 text-ink/70">
                      {h.days} {h.days === 1 ? 'Day' : 'Days'}
                    </span>
                  </span>
                  <span
                    className={`inline-block w-fit text-xs px-2 py-1 rounded-full font-medium ${
                      h.active ? 'bg-brand-50 text-brand-700' : 'bg-black/5 text-ink/60'
                    }`}
                  >
                    {h.active ? 'Active' : 'Inactive'}
                  </span>
                  <div className="flex items-center justify-end gap-2">
                    <IconButton icon={Pencil} title="Edit" onClick={() => setEditItem(h)} requires="edit" />
                    <IconButton icon={Trash2} tone="danger" title="Remove" onClick={() => onDelete(h)} requires="full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {showAdd && (
        <HolidayFormModal
          title="Add Holiday"
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
      {editItem && (
        <HolidayFormModal
          title="Edit Holiday"
          holiday={editItem}
          onClose={() => setEditItem(null)}
          onSaved={() => {
            setEditItem(null);
            load();
          }}
        />
      )}
      {showImport && (
        <Modal title="Import Holidays" onClose={() => setShowImport(false)}>
          <p className="text-sm text-muted">
            CSV import isn't wired up yet — this button is a placeholder for when that's ready. For now, add holidays one
            at a time with "Add Holiday".
          </p>
          <div className="flex justify-end pt-4">
            <SecondaryButton onClick={() => setShowImport(false)}>Close</SecondaryButton>
          </div>
        </Modal>
      )}
    </>
  );
}

function HolidayFormModal({
  title,
  holiday,
  onClose,
  onSaved,
}: {
  title: string;
  holiday?: HolidayItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(holiday?.name || '');
  const [dateFrom, setDateFrom] = useState(holiday?.dateFrom || todayStr());
  const [dateTo, setDateTo] = useState(holiday?.dateTo || todayStr());
  const [active, setActive] = useState(holiday?.active ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const days = daySpan(dateFrom, dateTo);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !dateFrom || !dateTo) return;
    setBusy(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        dateFrom,
        dateTo,
        days,
        active,
      };
      if (holiday) {
        await api.patch(`/holidays/${holiday.id}`, payload);
      } else {
        await api.post('/holidays', payload);
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <input className={inputClass} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} required />
          </Field>
          <Field label="To">
            <input className={inputClass} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} required />
          </Field>
        </div>
        <Field label="Days">
          <input className={inputClass} value={`${days} ${days === 1 ? 'Day' : 'Days'}`} readOnly disabled />
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink/80 cursor-pointer">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy} requires="edit">
            {busy ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

const DASHBOARD_PAGE_SIZE_OPTIONS = [10, 25, 50];

function greetingNow() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function DashboardTab({ employees, shifts }: { employees: Employee[]; shifts: ShiftItem[] }) {
  const [todayRecords, setTodayRecords] = useState<AttendanceRecord[]>([]);
  const [pendingLeaves, setPendingLeaves] = useState(0);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [holidays, setHolidays] = useState<HolidayItem[]>([]);
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);

  function loadToday() {
    api.get(`/attendance/date/${todayStr()}`).then((res) => setTodayRecords(res.data));
  }

  useEffect(loadToday, []);
  useEffect(() => {
    api.get('/leave-requests').then((res) => setPendingLeaves(res.data.filter((r: LeaveRequestItem) => r.status === 'pending').length));
  }, []);
  useEffect(() => {
    api.get('/notices').then((res) => setNotices(res.data.filter((n: NoticeItem) => n.active).slice(0, 5)));
  }, []);
  useEffect(() => {
    const today = todayStr();
    api.get('/events').then((res) =>
      setEvents(
        res.data
          .filter((e: EventItem) => e.active && e.date >= today)
          .sort((a: EventItem, b: EventItem) => a.date.localeCompare(b.date))
          .slice(0, 5),
      ),
    );
  }, []);
  useEffect(() => {
    const today = todayStr();
    api.get('/holidays').then((res) =>
      setHolidays(
        res.data
          .filter((h: HolidayItem) => h.active && h.dateTo >= today)
          .sort((a: HolidayItem, b: HolidayItem) => a.dateFrom.localeCompare(b.dateFrom))
          .slice(0, 5),
      ),
    );
  }, []);
  useEffect(() => setPage(1), [search, pageSize]);

  const activeEmployees = employees.filter((e) => e.active);
  const recordFor = (employeeId: string) => todayRecords.find((r) => r.employeeId === employeeId);
  const loggedInCount = todayRecords.filter((r) => r.checkIn && !r.checkOut).length;

  // Quick check-in/out straight from the dashboard — uses the device's own
  // clock (like the manual "Mark attendance" flow), not the Oman-time
  // correction the fingerprint device endpoint applies. Fine for a quick
  // office-computer punch; for accurate payroll timestamps, the
  // fingerprint device is still the more reliable source.
  async function onLogin(emp: Employee) {
    setBusyId(emp.id);
    try {
      const time = new Date().toTimeString().slice(0, 8);
      await api.post('/attendance', { employeeId: emp.id, checkIn: time });
      loadToday();
    } finally {
      setBusyId(null);
    }
  }
  async function onLogout(emp: Employee) {
    setBusyId(emp.id);
    try {
      const time = new Date().toTimeString().slice(0, 8);
      await api.post('/attendance', { employeeId: emp.id, checkOut: time });
      loadToday();
    } finally {
      setBusyId(null);
    }
  }

  const searchTerm = search.trim().toLowerCase();
  const filtered = searchTerm ? activeEmployees.filter((e) => e.name.toLowerCase().includes(searchTerm)) : activeEmployees;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your workforce, real-time metrics, and recent updates."
        action={
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink bg-white border border-black/10 rounded-lg px-3 py-1.5">
            <CalendarDays size={14} className="text-muted" />
            {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard icon={Sun} label="Welcome" value={greetingNow()} />
        <StatCard icon={Bell} label="Pending Requests" value={String(pendingLeaves)} />
        <StatCard icon={CalendarDays} label="Shifts" value={String(shifts.length)} />
        <StatCard icon={Users} label="Staffs" value={String(activeEmployees.length)} sub={`Logged In (${loggedInCount})`} />
      </div>

      <Card className="mb-5">
        <div className="px-4 py-3 border-b border-black/10">
          <h3 className="text-sm font-semibold text-brand-700">Staff's Live Status</h3>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-black/10 text-sm">
          <label className="flex items-center gap-2 text-muted">
            Show
            <select
              className="rounded-lg border border-black/15 px-2 py-1 text-sm"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {DASHBOARD_PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            entries
          </label>
          <div className="relative w-full sm:w-56">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input className={`${inputClass} pl-8`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" />
          </div>
        </div>

        {activeEmployees.length === 0 ? (
          <EmptyState>No active staff yet.</EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState>No staff match "{search}".</EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <div className="grid grid-cols-[45px_90px_1.2fr_100px_100px_90px_90px_90px_120px_120px_110px_110px] px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wide bg-black/[0.02] min-w-[1320px] sm:min-w-[1200px]">
                <span>No.</span>
                <span>Staff ID</span>
                <span>Name</span>
                <span>Office In</span>
                <span>Office Out</span>
                <span>Lunch In</span>
                <span>Lunch Out</span>
                <span>Break</span>
                <span>Working Hour's</span>
                <span>Punctuality</span>
                <span>Status</span>
                <span className="text-right">Action</span>
              </div>
              <div className="divide-y divide-black/5 min-w-[1320px] sm:min-w-[1200px]">
                {paged.map((emp, i) => {
                  const rec = recordFor(emp.id);
                  const loggedIn = !!rec?.checkIn && !rec?.checkOut;
                  const loggedOut = !!rec?.checkOut;
                  return (
                    <div
                      key={emp.id}
                      className="grid grid-cols-[45px_90px_1.2fr_100px_100px_90px_90px_90px_120px_120px_110px_110px] items-center px-4 py-3"
                    >
                      <span className="text-sm text-muted">{(currentPage - 1) * pageSize + i + 1}.</span>
                      <span className="text-sm text-muted truncate pr-2">{emp.staffId || '-'}</span>
                      <span className="text-sm font-medium text-ink truncate pr-2 flex items-center gap-1.5">
                        <CountryFlag code={emp.nationality} />
                        {emp.name}
                      </span>
                      <span className="text-sm text-muted">{rec?.checkIn || '--'}</span>
                      <span className="text-sm text-muted">{rec?.checkOut || '--'}</span>
                      <span className="text-sm text-muted">{rec?.lunchIn || '--'}</span>
                      <span className="text-sm text-muted">{rec?.lunchOut || '--'}</span>
                      <span className="text-sm text-muted">{rec?.breakMinutes != null ? `${rec.breakMinutes}m` : '--'}</span>
                      <span className="text-sm text-muted">{workingHoursOf(rec?.checkIn, rec?.checkOut)}</span>
                      <span className="text-sm text-muted">{rec?.status ? labelFor(ATTENDANCE_STATUS_OPTIONS, rec.status) : '--'}</span>
                      <span>
                        <span
                          className={`inline-block text-xs px-2 py-1 rounded-full font-medium ${
                            loggedIn ? 'bg-brand-50 text-brand-700' : loggedOut ? 'bg-black/5 text-ink/60' : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {loggedIn ? 'Logged In' : loggedOut ? 'Logged Out' : 'Not Started'}
                        </span>
                      </span>
                      <div className="flex items-center justify-end">
                        {loggedOut ? (
                          <span className="text-xs text-muted">Done</span>
                        ) : loggedIn ? (
                          <SecondaryButton onClick={() => onLogout(emp)} className="!px-3 !py-1 text-xs" requires="edit">
                            {busyId === emp.id ? '…' : 'Logout'}
                          </SecondaryButton>
                        ) : (
                          <PrimaryButton onClick={() => onLogin(emp)} className="!px-3 !py-1 text-xs" requires="edit">
                            {busyId === emp.id ? '…' : 'Login'}
                          </PrimaryButton>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-between px-4 py-3 text-xs text-muted">
              <span>
                Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filtered.length)} of{' '}
                {filtered.length} entries
              </span>
              <div className="flex items-center gap-1">
                <SecondaryButton onClick={() => setPage(Math.max(1, currentPage - 1))} className={currentPage === 1 ? 'opacity-50' : ''}>
                  Previous
                </SecondaryButton>
                {Array.from({ length: totalPages }, (_, idx) => idx + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPage(n)}
                    className={`w-8 h-8 rounded-lg text-xs font-medium border ${
                      n === currentPage ? 'bg-brand-500 border-brand-500 text-ink' : 'bg-white border-black/10 text-ink/70 hover:bg-black/5'
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <SecondaryButton
                  onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                  className={currentPage === totalPages ? 'opacity-50' : ''}
                >
                  Next
                </SecondaryButton>
              </div>
            </div>
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-amber-700 mb-3">Notices</h3>
          {notices.length === 0 ? (
            <p className="text-sm text-muted">No Notice Found!</p>
          ) : (
            <div className="divide-y divide-black/5">
              {notices.map((n) => (
                <div key={n.id} className="py-2 text-sm">
                  <div className="font-medium text-ink">{n.title}</div>
                  <div className="text-xs text-muted truncate">{n.description || '-'}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-emerald-700 mb-3">Upcoming Events</h3>
          {events.length === 0 ? (
            <p className="text-sm text-muted">No Events Found!</p>
          ) : (
            <div className="divide-y divide-black/5">
              {events.map((e) => (
                <div key={e.id} className="py-2 flex items-center justify-between text-sm">
                  <span className="text-ink">{e.name}</span>
                  <span className="text-xs text-muted">{formatDate(e.date)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-rose-700 mb-3">Upcoming Holidays</h3>
          {holidays.length === 0 ? (
            <p className="text-sm text-muted">No Holiday Found!</p>
          ) : (
            <div className="divide-y divide-black/5">
              {holidays.map((h) => (
                <div key={h.id} className="py-2 flex items-center justify-between text-sm">
                  <span className="text-ink">{h.name}</span>
                  <span className="text-xs text-muted">
                    {formatDate(h.dateFrom)} · {h.days} {h.days === 1 ? 'Day' : 'Days'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

const ARCHIVE_WORKED_DAYS_THRESHOLD = 15;

// Opens when "Delete" is clicked on the Employees tab. Instead of erasing
// the employee, it reads their real attendance history to suggest — and
// let the user confirm or override — where this record should go:
// Old Employees (worked 15+ days, was paid), Temporary Employees (worked
// under 15 days, was paid), or a genuine mistake entry (never joined /
// duplicate), which is the one case that still deletes for good.
function ArchiveEmployeeModal({
  employee,
  onClose,
  onDone,
}: {
  employee: Employee;
  onClose: () => void;
  onDone: () => void;
}) {
  const [loadingDays, setLoadingDays] = useState(true);
  const [workedDays, setWorkedDays] = useState(0);
  const [choice, setChoice] = useState<'old' | 'temporary' | 'delete'>('temporary');
  const [suggested, setSuggested] = useState<'old' | 'temporary' | 'delete'>('temporary');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Permanent delete needs 'full' — without it only the archive options show.
  const can = useCan();
  const canDelete = can('full');

  useEffect(() => {
    let cancelled = false;
    api.get(`/attendance/employee/${employee.id}`).then((res) => {
      if (cancelled) return;
      const records: AttendanceRecord[] = res.data;
      const days = records.reduce((sum, r) => {
        if (r.status === 'present' || r.status === 'late') return sum + 1;
        if (r.status === 'half_day') return sum + 0.5;
        return sum;
      }, 0);
      const suggestion: 'old' | 'temporary' | 'delete' =
        days === 0 ? 'delete' : days >= ARCHIVE_WORKED_DAYS_THRESHOLD ? 'old' : 'temporary';
      setWorkedDays(days);
      setSuggested(suggestion);
      setChoice(suggestion === 'delete' && !canDelete ? 'temporary' : suggestion);
      setLoadingDays(false);
    });
    return () => {
      cancelled = true;
    };
  }, [employee.id]);

  async function onConfirm() {
    setBusy(true);
    setError('');
    try {
      if (choice === 'delete') {
        if (
          !window.confirm(
            `Permanently delete "${employee.name}"? This cannot be undone — attendance/payroll history tied to this employee will stay, but this employee record itself will be gone for good.`,
          )
        ) {
          setBusy(false);
          return;
        }
        await api.delete(`/employees/${employee.id}`);
      } else {
        await api.patch(`/employees/${employee.id}/archive`, { archiveType: choice });
      }
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not complete this action.');
    } finally {
      setBusy(false);
    }
  }

  const options: { value: 'old' | 'temporary' | 'delete'; title: string; description: string }[] = [
    {
      value: 'old',
      title: 'Old Employee',
      description: 'Worked 15+ days and was paid — move to the Old Employees folder (kept on file, restorable).',
    },
    {
      value: 'temporary',
      title: 'Temporary Employee',
      description: 'Worked under 15 days and was paid — move to the Temporary Employees folder (kept on file, restorable).',
    },
    {
      value: 'delete',
      title: 'Never joined / Duplicate entry',
      description: 'Never actually started work, or this is a duplicate record — delete permanently. Cannot be undone.',
    },
  ];

  return (
    <Modal title={`Delete — ${employee.name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted">
          {loadingDays ? (
            'Checking attendance history…'
          ) : (
            <>
              Worked days on record: <span className="font-semibold text-ink">{workedDays}</span>
              {suggested !== 'delete' && (
                <> — suggested: <span className="font-semibold text-ink">{suggested === 'old' ? 'Old Employee' : 'Temporary Employee'}</span></>
              )}
            </>
          )}
        </p>
        <div className="space-y-2">
          {options.filter((opt) => opt.value !== 'delete' || canDelete).map((opt) => (
            <label
              key={opt.value}
              className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                choice === opt.value ? 'border-brand-500 bg-brand-50' : 'border-black/10 hover:bg-black/[0.02]'
              }`}
            >
              <input
                type="radio"
                name="archiveChoice"
                className="mt-1"
                checked={choice === opt.value}
                onChange={() => setChoice(opt.value)}
              />
              <span>
                <span className="block text-sm font-medium text-ink">
                  {opt.title}
                  {opt.value === suggested && !loadingDays && (
                    <span className="ml-2 text-xs font-normal text-brand-600">(suggested)</span>
                  )}
                </span>
                <span className="block text-xs text-muted mt-0.5">{opt.description}</span>
              </span>
            </label>
          ))}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={onConfirm} disabled={busy || loadingDays} requires="edit">
            {busy ? 'Working…' : choice === 'delete' ? 'Delete Permanently' : 'Move to Folder'}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

// Shared list view for the Old Employees / Temporary Employees tabs —
// archived records are kept in full (not deleted), so this is mostly a
// read view plus Restore (undo the archive) and a genuine permanent
// Delete for a record that really shouldn't have been kept at all.
// Renders the Old/Temporary Employees list. No PageHeader of its own —
// it's shown embedded inside the Employees tab (below the sub-tab pill
// switcher), which already has the page title.
function ArchivedEmployeesTab({
  archiveType,
  subtitle,
  employees,
  designations,
  onChanged,
}: {
  archiveType: 'old' | 'temporary';
  subtitle: string;
  employees: Employee[];
  designations: DesignationItem[];
  onChanged: () => void;
}) {
  void archiveType;
  const [busyId, setBusyId] = useState<string | null>(null);

  async function onRestore(emp: Employee) {
    if (!window.confirm(`Restore "${emp.name}" to the active Employees list?`)) return;
    setBusyId(emp.id);
    try {
      await api.patch(`/employees/${emp.id}/restore`);
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(emp: Employee) {
    if (
      !window.confirm(`Permanently delete "${emp.name}"? This cannot be undone.`)
    )
      return;
    setBusyId(emp.id);
    try {
      await api.delete(`/employees/${emp.id}`);
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <p className="text-sm text-muted mb-3">{subtitle}</p>
      {employees.length === 0 ? (
        <EmptyState>Nothing here yet.</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {employees.map((e) => (
              <div key={e.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-ink flex items-center gap-1.5">
                    {e.name}
                    {e.staffId ? ` · ${e.staffId}` : ''}
                  </div>
                  <div className="text-xs text-muted flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: designationColorFor(designations, e.role) || '#9ca3af' }}
                      />
                      {roleLabel(e.role)}
                    </span>
                    {e.department ? ` · ${e.department}` : ''}
                    {' · Archived '}
                    {e.archivedAt ? formatDate(e.archivedAt.slice(0, 10)) : '-'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <SecondaryButton onClick={() => onRestore(e)} disabled={busyId === e.id} requires="edit">
                    {busyId === e.id ? '…' : 'Restore'}
                  </SecondaryButton>
                  <IconButton icon={Trash2} tone="danger" title="Delete permanently" onClick={() => onDelete(e)} requires="full" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

// The "Others Detail" block shared by AddEmployeeModal and
// EditEmployeeModal — same 20+ optional fields, plain strings so a blank
// field can be sent as `undefined` (not saved) rather than an empty write.
interface OtherDetailValues {
  fatherName: string;
  motherName: string;
  birthDate: string;
  passportNumber: string;
  nationality: string;
  originCountryIdNumber: string;
  homeAddress: string;
  educationalQualifications: string;
  skills: string;
  certifications: string;
  guardianName: string;
  guardianPhone: string;
  guardianNationalId: string;
  guardianRelationship: string;
  guardianAddress: string;
  emergencyPhone1: string;
  emergencyPhone2: string;
  nomineeName: string;
  nomineeNationalId: string;
  nomineePhone: string;
  nomineeRelationship: string;
}
function emptyOtherDetail(): OtherDetailValues {
  return {
    fatherName: '', motherName: '', birthDate: '', passportNumber: '', nationality: '',
    originCountryIdNumber: '', homeAddress: '', educationalQualifications: '', skills: '', certifications: '',
    guardianName: '', guardianPhone: '', guardianNationalId: '', guardianRelationship: '', guardianAddress: '',
    emergencyPhone1: '', emergencyPhone2: '', nomineeName: '', nomineeNationalId: '', nomineePhone: '', nomineeRelationship: '',
  };
}
function otherDetailFromEmployee(e: Employee): OtherDetailValues {
  return {
    fatherName: e.fatherName || '', motherName: e.motherName || '', birthDate: e.birthDate || '',
    passportNumber: e.passportNumber || '', nationality: e.nationality || '',
    originCountryIdNumber: e.originCountryIdNumber || '', homeAddress: e.homeAddress || '',
    educationalQualifications: e.educationalQualifications || '', skills: e.skills || '', certifications: e.certifications || '',
    guardianName: e.guardianName || '', guardianPhone: e.guardianPhone || '', guardianNationalId: e.guardianNationalId || '',
    guardianRelationship: e.guardianRelationship || '', guardianAddress: e.guardianAddress || '',
    emergencyPhone1: e.emergencyPhone1 || '', emergencyPhone2: e.emergencyPhone2 || '',
    nomineeName: e.nomineeName || '', nomineeNationalId: e.nomineeNationalId || '',
    nomineePhone: e.nomineePhone || '', nomineeRelationship: e.nomineeRelationship || '',
  };
}
// Turns the (all-optional) OtherDetailValues into a payload where blank
// fields are omitted (`undefined`) rather than overwriting saved data
// with empty strings.
function otherDetailPayload(v: OtherDetailValues) {
  const out: Record<string, string | undefined> = {};
  (Object.keys(v) as (keyof OtherDetailValues)[]).forEach((k) => {
    out[k] = v[k] ? v[k] : undefined;
  });
  return out;
}

function OtherDetailFields({
  value,
  onChange,
  guardianPhotoPreview,
  onGuardianPhotoSelected,
  nomineePhotoPreview,
  onNomineePhotoSelected,
}: {
  value: OtherDetailValues;
  onChange: (patch: Partial<OtherDetailValues>) => void;
  guardianPhotoPreview: string | null;
  onGuardianPhotoSelected: (file: File) => void;
  nomineePhotoPreview: string | null;
  onNomineePhotoSelected: (file: File) => void;
}) {
  const guardianPhotoInputRef = useRef<HTMLInputElement>(null);
  const nomineePhotoInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-3 border-t border-black/10 pt-3 mt-1">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Father's Name (optional)">
          <input className={inputClass} value={value.fatherName} onChange={(e) => onChange({ fatherName: e.target.value })} />
        </Field>
        <Field label="Mother's Name (optional)">
          <input className={inputClass} value={value.motherName} onChange={(e) => onChange({ motherName: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Birth Date (optional)">
          <input className={inputClass} type="date" value={value.birthDate} onChange={(e) => onChange({ birthDate: e.target.value })} />
        </Field>
        <Field label="Passport Number (optional)">
          <input className={inputClass} value={value.passportNumber} onChange={(e) => onChange({ passportNumber: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nationality (optional)">
          <select className={inputClass} value={value.nationality} onChange={(e) => onChange({ nationality: e.target.value })}>
            <option value="">-</option>
            {SORTED_COUNTRY_LIST.map((c) => (
              <option key={c.code} value={c.code}>
                {flagEmoji(c.code)} {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Origin Country ID Number (optional)">
          <input
            className={inputClass}
            value={value.originCountryIdNumber}
            onChange={(e) => onChange({ originCountryIdNumber: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Home Address (optional)">
        <textarea
          className={inputClass}
          rows={2}
          value={value.homeAddress}
          onChange={(e) => onChange({ homeAddress: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Educational Qualifications (optional)">
          <input
            className={inputClass}
            value={value.educationalQualifications}
            onChange={(e) => onChange({ educationalQualifications: e.target.value })}
          />
        </Field>
        <Field label="Skills (optional)">
          <input className={inputClass} value={value.skills} onChange={(e) => onChange({ skills: e.target.value })} />
        </Field>
      </div>
      <Field label="Certifications (optional)">
        <input className={inputClass} value={value.certifications} onChange={(e) => onChange({ certifications: e.target.value })} />
      </Field>

      <div className="text-xs font-semibold text-muted uppercase tracking-wide pt-2">Wife / Guardian</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Wife/Guardian's Name (optional)">
          <input className={inputClass} value={value.guardianName} onChange={(e) => onChange({ guardianName: e.target.value })} />
        </Field>
        <Field label="Wife/Guardian's Phone Number (optional)">
          <input className={inputClass} value={value.guardianPhone} onChange={(e) => onChange({ guardianPhone: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Wife/Guardian's National ID Number (optional)">
          <input
            className={inputClass}
            value={value.guardianNationalId}
            onChange={(e) => onChange({ guardianNationalId: e.target.value })}
          />
        </Field>
        <Field label="Relationship with Wife/Guardian (optional)">
          <input
            className={inputClass}
            value={value.guardianRelationship}
            onChange={(e) => onChange({ guardianRelationship: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Wife/Guardian's Address (optional)">
        <textarea
          className={inputClass}
          rows={2}
          value={value.guardianAddress}
          onChange={(e) => onChange({ guardianAddress: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Emergency Phone Number 1 (optional)">
          <input className={inputClass} value={value.emergencyPhone1} onChange={(e) => onChange({ emergencyPhone1: e.target.value })} />
        </Field>
        <Field label="Emergency Phone Number 2 (optional)">
          <input className={inputClass} value={value.emergencyPhone2} onChange={(e) => onChange({ emergencyPhone2: e.target.value })} />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-lg border border-black/10 bg-black/5 flex items-center justify-center overflow-hidden shrink-0">
          {guardianPhotoPreview ? (
            <img src={guardianPhotoPreview} alt="" className="w-full h-full object-cover" />
          ) : (
            <User size={20} className="text-muted" />
          )}
        </div>
        <div>
          <span className="block text-xs font-medium text-muted mb-1">Wife/Guardian's Image (optional)</span>
          <input
            ref={guardianPhotoInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onGuardianPhotoSelected(e.target.files[0])}
          />
          <SecondaryButton icon={Upload} onClick={() => guardianPhotoInputRef.current?.click()}>
            {guardianPhotoPreview ? 'Change photo' : 'Upload photo'}
          </SecondaryButton>
        </div>
      </div>

      <div className="text-xs font-semibold text-muted uppercase tracking-wide pt-2">Nominee</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nominee Name (optional)">
          <input className={inputClass} value={value.nomineeName} onChange={(e) => onChange({ nomineeName: e.target.value })} />
        </Field>
        <Field label="Nominee National ID / Birth Certificate Number (optional)">
          <input
            className={inputClass}
            value={value.nomineeNationalId}
            onChange={(e) => onChange({ nomineeNationalId: e.target.value })}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nominee Phone Number (optional)">
          <input className={inputClass} value={value.nomineePhone} onChange={(e) => onChange({ nomineePhone: e.target.value })} />
        </Field>
        <Field label="Relationship with Nominee (optional)">
          <input
            className={inputClass}
            value={value.nomineeRelationship}
            onChange={(e) => onChange({ nomineeRelationship: e.target.value })}
          />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-lg border border-black/10 bg-black/5 flex items-center justify-center overflow-hidden shrink-0">
          {nomineePhotoPreview ? (
            <img src={nomineePhotoPreview} alt="" className="w-full h-full object-cover" />
          ) : (
            <User size={20} className="text-muted" />
          )}
        </div>
        <div>
          <span className="block text-xs font-medium text-muted mb-1">Nominee's Image (optional)</span>
          <input
            ref={nomineePhotoInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onNomineePhotoSelected(e.target.files[0])}
          />
          <SecondaryButton icon={Upload} onClick={() => nomineePhotoInputRef.current?.click()}>
            {nomineePhotoPreview ? 'Change photo' : 'Upload photo'}
          </SecondaryButton>
        </div>
      </div>
    </div>
  );
}

interface PayExtrasValue {
  housing: string;
  transport: string;
  other: string;
  spf: boolean | null; // null = follow nationality (Omani -> covered)
  leftDate: string;
}
function emptyPayExtras(): PayExtrasValue {
  return { housing: '', transport: '', other: '', spf: null, leftDate: '' };
}
function payExtrasFromEmployee(e: Employee): PayExtrasValue {
  const n = (v?: number) => (v != null && Number(v) !== 0 ? String(v) : '');
  return {
    housing: n(e.housingAllowance),
    transport: n(e.transportAllowance),
    other: n(e.otherAllowance),
    spf: e.socialProtectionCovered ?? null,
    leftDate: e.leftDate || '',
  };
}
function payExtrasPayload(v: PayExtrasValue) {
  return {
    housingAllowance: Number(v.housing) || 0,
    transportAllowance: Number(v.transport) || 0,
    otherAllowance: Number(v.other) || 0,
    ...(v.spf === null ? {} : { socialProtectionCovered: v.spf }),
    leftDate: v.leftDate || '',
  };
}

// Allowances, Social Protection cover and last working day - feed payroll
// and end-of-service gratuity (gratuity is on basic only).
function PayExtras({ value, onChange, nationality }: { value: PayExtrasValue; onChange: (v: PayExtrasValue) => void; nationality?: string }) {
  const covered = value.spf ?? (nationality || '').toUpperCase() === 'OM';
  const num = (key: 'housing' | 'transport' | 'other', label: string) => (
    <Field label={label}>
      <input className={inputClass} type="number" min="0" step="0.001" value={value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.value })} placeholder="0.000" />
    </Field>
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {num('housing', 'Housing allowance')}
        {num('transport', 'Transport allowance')}
        {num('other', 'Other allowance')}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex items-start gap-2 text-sm text-ink/80 mt-1">
          <input type="checkbox" className="mt-0.5" checked={covered} onChange={(e) => onChange({ ...value, spf: e.target.checked })} />
          <span>
            Social Protection Fund (Omani staff)
            <span className="block text-xs text-muted">SPF is deducted from pay; no end-of-service gratuity.</span>
          </span>
        </label>
        <Field label="Last working day (leaving staff)">
          <input className={inputClass} type="date" value={value.leftDate} onChange={(e) => onChange({ ...value, leftDate: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

function AddEmployeeModal({
  designations,
  teams,
  departments,
  shifts,
  onClose,
  onSaved,
}: {
  designations: DesignationItem[];
  teams: RoleOrTeam[];
  departments: DepartmentItem[];
  shifts: ShiftItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState(designations[0]?.name || '');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [staffId, setStaffId] = useState('');
  const [department, setDepartment] = useState('');
  const [team, setTeam] = useState('');
  const [shift, setShift] = useState('');
  const [baseSalary, setBaseSalary] = useState('');
  const [pay, setPay] = useState<PayExtrasValue>(emptyPayExtras());
  const [otRatePerHour, setOtRatePerHour] = useState('');
  const [biometricId, setBiometricId] = useState('');
  const [joinedDate, setJoinedDate] = useState(todayStr());
  const [employmentType, setEmploymentType] = useState('permanent');
  const [status, setStatus] = useState('working');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [otherDetail, setOtherDetail] = useState<OtherDetailValues>(emptyOtherDetail());
  const [guardianPhotoFile, setGuardianPhotoFile] = useState<File | null>(null);
  const [guardianPhotoPreview, setGuardianPhotoPreview] = useState<string | null>(null);
  const [nomineePhotoFile, setNomineePhotoFile] = useState<File | null>(null);
  const [nomineePhotoPreview, setNomineePhotoPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  function onPhotoSelected(file: File) {
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }
  function onGuardianPhotoSelected(file: File) {
    setGuardianPhotoFile(file);
    setGuardianPhotoPreview(URL.createObjectURL(file));
  }
  function onNomineePhotoSelected(file: File) {
    setNomineePhotoFile(file);
    setNomineePhotoPreview(URL.createObjectURL(file));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/employees', {
        name,
        role,
        phone: phone || undefined,
        email: email || undefined,
        staffId: staffId || undefined,
        department: department || undefined,
        team: team || undefined,
        shift: shift || undefined,
        baseSalary: baseSalary ? Number(baseSalary) : undefined,
        ...payExtrasPayload(pay),
        otRatePerHour: otRatePerHour ? Number(otRatePerHour) : undefined,
        biometricId: biometricId || undefined,
        joinedDate: joinedDate || undefined,
        employmentType,
        status,
        ...otherDetailPayload(otherDetail),
      });
      // Photo(s) are uploaded as a separate step since the employee record
      // (and its id) needs to exist first.
      if (photoFile) {
        const formData = new FormData();
        formData.append('file', photoFile);
        await api.post(`/employees/${res.data.id}/photo`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      if (guardianPhotoFile) {
        const formData = new FormData();
        formData.append('file', guardianPhotoFile);
        await api.post(`/employees/${res.data.id}/guardian-photo`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      if (nomineePhotoFile) {
        const formData = new FormData();
        formData.append('file', nomineePhotoFile);
        await api.post(`/employees/${res.data.id}/nominee-photo`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New employee" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-16 h-16 rounded-lg border border-black/10 bg-black/5 flex items-center justify-center overflow-hidden shrink-0">
            {photoPreview ? (
              <img src={photoPreview} alt="" className="w-full h-full object-cover" />
            ) : (
              <User size={24} className="text-muted" />
            )}
          </div>
          <div>
            <span className="block text-xs font-medium text-muted mb-1">Photo (optional)</span>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onPhotoSelected(e.target.files[0])}
            />
            <SecondaryButton icon={Upload} onClick={() => photoInputRef.current?.click()}>
              {photoFile ? 'Change photo' : 'Upload photo'}
            </SecondaryButton>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Staff ID (optional)">
            <input className={inputClass} value={staffId} onChange={(e) => setStaffId(e.target.value)} placeholder="EMP-001" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Designation (Role)">
            <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} required>
              {designations.length === 0 && <option value="">No designations yet — add one first</option>}
              {designations.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Team (optional)">
            <select className={inputClass} value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">-</option>
              {teams.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Department (optional)">
            <select className={inputClass} value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">-</option>
              {departments.map((dep) => (
                <option key={dep.id} value={dep.name}>
                  {dep.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Shift (optional)">
            <select className={inputClass} value={shift} onChange={(e) => setShift(e.target.value)}>
              <option value="">-</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone">
            <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Email">
            <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Joining Date">
            <input className={inputClass} type="date" value={joinedDate} onChange={(e) => setJoinedDate(e.target.value)} />
          </Field>
          <Field label="Employment Type">
            <select className={inputClass} value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
              {EMPLOYMENT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
              {EMPLOYEE_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Basic salary (monthly, OMR)">
            <input
              className={inputClass}
              type="number"
              min="0"
              step="0.001"
              value={baseSalary}
              onChange={(e) => setBaseSalary(e.target.value)}
            />
          </Field>
        </div>
        <PayExtras value={pay} onChange={setPay} nationality={otherDetail.nationality} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="OT Rate Override (optional, per hour)">
            <input
              className={inputClass}
              type="number"
              min="0"
              step="0.01"
              value={otRatePerHour}
              onChange={(e) => setOtRatePerHour(e.target.value)}
              placeholder="Leave blank to use department's default"
            />
          </Field>
          <Field label="Biometric ID (optional — for a fingerprint device, once connected)">
            <input className={inputClass} value={biometricId} onChange={(e) => setBiometricId(e.target.value)} />
          </Field>
        </div>

        <div className="pt-1">
          <SecondaryButton icon={ChevronDown} onClick={() => setShowOthers((v) => !v)} className={showOthers ? '[&>svg]:rotate-180' : ''}>
            Others Detail
          </SecondaryButton>
        </div>
        {showOthers && (
          <OtherDetailFields
            value={otherDetail}
            onChange={(patch) => setOtherDetail((v) => ({ ...v, ...patch }))}
            guardianPhotoPreview={guardianPhotoPreview}
            onGuardianPhotoSelected={onGuardianPhotoSelected}
            nomineePhotoPreview={nomineePhotoPreview}
            onNomineePhotoSelected={onNomineePhotoSelected}
          />
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy} requires="edit">{busy ? 'Saving…' : 'Save'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function EditEmployeeModal({
  employee,
  designations,
  teams,
  departments,
  shifts,
  onClose,
  onSaved,
}: {
  employee: Employee;
  designations: DesignationItem[];
  teams: RoleOrTeam[];
  departments: DepartmentItem[];
  shifts: ShiftItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(employee.name);
  const [role, setRole] = useState(employee.role);
  const [phone, setPhone] = useState(employee.phone || '');
  const [email, setEmail] = useState(employee.email || '');
  const [staffId, setStaffId] = useState(employee.staffId || '');
  const [department, setDepartment] = useState(employee.department || '');
  const [team, setTeam] = useState(employee.team || '');
  const [shift, setShift] = useState(employee.shift || '');
  const [baseSalary, setBaseSalary] = useState(employee.baseSalary != null ? String(employee.baseSalary) : '');
  const [pay, setPay] = useState<PayExtrasValue>(() => payExtrasFromEmployee(employee));
  const [otRatePerHour, setOtRatePerHour] = useState(employee.otRatePerHour != null ? String(employee.otRatePerHour) : '');
  const [biometricId, setBiometricId] = useState(employee.biometricId || '');
  const [joinedDate, setJoinedDate] = useState(employee.joinedDate || '');
  const [employmentType, setEmploymentType] = useState(employee.employmentType || 'permanent');
  const [status, setStatus] = useState(employee.status || 'working');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [otherDetail, setOtherDetail] = useState<OtherDetailValues>(() => otherDetailFromEmployee(employee));
  const [guardianPhotoFile, setGuardianPhotoFile] = useState<File | null>(null);
  const [guardianPhotoPreview, setGuardianPhotoPreview] = useState<string | null>(null);
  const [nomineePhotoFile, setNomineePhotoFile] = useState<File | null>(null);
  const [nomineePhotoPreview, setNomineePhotoPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Show the employee's current photo(s) (if any) as the starting preview —
  // fetched as a blob since these are protected routes.
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    if (employee.photoPath) {
      fetchFileBlobUrl(`/employees/${employee.id}/photo`).then((u) => {
        if (cancelled) return;
        objectUrl = u;
        setPhotoPreview(u);
      }).catch(() => {});
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [employee.id, employee.photoPath]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    if (employee.guardianPhotoPath) {
      fetchFileBlobUrl(`/employees/${employee.id}/guardian-photo`).then((u) => {
        if (cancelled) return;
        objectUrl = u;
        setGuardianPhotoPreview(u);
      }).catch(() => {});
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [employee.id, employee.guardianPhotoPath]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    if (employee.nomineePhotoPath) {
      fetchFileBlobUrl(`/employees/${employee.id}/nominee-photo`).then((u) => {
        if (cancelled) return;
        objectUrl = u;
        setNomineePhotoPreview(u);
      }).catch(() => {});
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [employee.id, employee.nomineePhotoPath]);

  function onPhotoSelected(file: File) {
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }
  function onGuardianPhotoSelected(file: File) {
    setGuardianPhotoFile(file);
    setGuardianPhotoPreview(URL.createObjectURL(file));
  }
  function onNomineePhotoSelected(file: File) {
    setNomineePhotoFile(file);
    setNomineePhotoPreview(URL.createObjectURL(file));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.patch(`/employees/${employee.id}`, {
        name,
        role,
        phone,
        email,
        staffId,
        department,
        team,
        shift,
        baseSalary: baseSalary ? Number(baseSalary) : undefined,
        ...payExtrasPayload(pay),
        otRatePerHour: otRatePerHour ? Number(otRatePerHour) : undefined,
        biometricId,
        joinedDate: joinedDate || undefined,
        employmentType,
        status,
        ...otherDetailPayload(otherDetail),
      });
      if (photoFile) {
        const formData = new FormData();
        formData.append('file', photoFile);
        await api.post(`/employees/${employee.id}/photo`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      if (guardianPhotoFile) {
        const formData = new FormData();
        formData.append('file', guardianPhotoFile);
        await api.post(`/employees/${employee.id}/guardian-photo`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      if (nomineePhotoFile) {
        const formData = new FormData();
        formData.append('file', nomineePhotoFile);
        await api.post(`/employees/${employee.id}/nominee-photo`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit employee" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-16 h-16 rounded-lg border border-black/10 bg-black/5 flex items-center justify-center overflow-hidden shrink-0">
            {photoPreview ? (
              <img src={photoPreview} alt="" className="w-full h-full object-cover" />
            ) : (
              <User size={24} className="text-muted" />
            )}
          </div>
          <div>
            <span className="block text-xs font-medium text-muted mb-1">Photo (optional)</span>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onPhotoSelected(e.target.files[0])}
            />
            <SecondaryButton icon={Upload} onClick={() => photoInputRef.current?.click()}>
              {photoFile ? 'Change photo' : 'Upload photo'}
            </SecondaryButton>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Staff ID (optional)">
            <input className={inputClass} value={staffId} onChange={(e) => setStaffId(e.target.value)} placeholder="EMP-001" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Designation (Role)">
            <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)} required>
              {/* Keep the employee's current designation selectable even if it was later removed */}
              {!designations.some((d) => d.name === role) && role && <option value={role}>{roleLabel(role)}</option>}
              {designations.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Team (optional)">
            <select className={inputClass} value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">-</option>
              {!teams.some((t) => t.name === team) && team && <option value={team}>{team}</option>}
              {teams.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Department (optional)">
            <select className={inputClass} value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">-</option>
              {!departments.some((dep) => dep.name === department) && department && (
                <option value={department}>{department}</option>
              )}
              {departments.map((dep) => (
                <option key={dep.id} value={dep.name}>
                  {dep.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Shift (optional)">
            <select className={inputClass} value={shift} onChange={(e) => setShift(e.target.value)}>
              <option value="">-</option>
              {!shifts.some((s) => s.name === shift) && shift && <option value={shift}>{shift}</option>}
              {shifts.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone">
            <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Email">
            <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Joining Date">
            <input className={inputClass} type="date" value={joinedDate} onChange={(e) => setJoinedDate(e.target.value)} />
          </Field>
          <Field label="Employment Type">
            <select className={inputClass} value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
              {EMPLOYMENT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
              {EMPLOYEE_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Basic salary (monthly, OMR)">
            <input
              className={inputClass}
              type="number"
              min="0"
              step="0.001"
              value={baseSalary}
              onChange={(e) => setBaseSalary(e.target.value)}
            />
          </Field>
        </div>
        <PayExtras value={pay} onChange={setPay} nationality={otherDetail.nationality} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="OT Rate Override (optional, per hour)">
            <input
              className={inputClass}
              type="number"
              min="0"
              step="0.01"
              value={otRatePerHour}
              onChange={(e) => setOtRatePerHour(e.target.value)}
              placeholder="Leave blank to use department's default"
            />
          </Field>
          <Field label="Biometric ID (optional — for a fingerprint device, once connected)">
            <input className={inputClass} value={biometricId} onChange={(e) => setBiometricId(e.target.value)} />
          </Field>
        </div>

        <div className="pt-1">
          <SecondaryButton icon={ChevronDown} onClick={() => setShowOthers((v) => !v)} className={showOthers ? '[&>svg]:rotate-180' : ''}>
            Others Detail
          </SecondaryButton>
        </div>
        {showOthers && (
          <OtherDetailFields
            value={otherDetail}
            onChange={(patch) => setOtherDetail((v) => ({ ...v, ...patch }))}
            guardianPhotoPreview={guardianPhotoPreview}
            onGuardianPhotoSelected={onGuardianPhotoSelected}
            nomineePhotoPreview={nomineePhotoPreview}
            onNomineePhotoSelected={onNomineePhotoSelected}
          />
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy} requires="edit">{busy ? 'Saving…' : 'Save'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function ViewEmployeeModal({
  employee,
  departments,
  onClose,
}: {
  employee: Employee;
  departments: DepartmentItem[];
  onClose: () => void;
}) {
  const departmentOtRate = departments.find((d) => d.name === employee.department)?.otRatePerHour;
  const effectiveOtRate = employee.otRatePerHour != null ? employee.otRatePerHour : departmentOtRate;
  const [docs, setDocs] = useState<EmployeeDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [guardianPhotoUrl, setGuardianPhotoUrl] = useState<string | null>(null);
  const [nomineePhotoUrl, setNomineePhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    api.get(`/employees/${employee.id}/documents`).then((res) => setDocs(res.data)).finally(() => setDocsLoading(false));
  }, [employee.id]);

  // Guardian/Nominee photos are protected routes, same as the profile
  // photo — fetched as a blob rather than used directly as an <img src>.
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    if (employee.guardianPhotoPath) {
      fetchFileBlobUrl(`/employees/${employee.id}/guardian-photo`).then((u) => {
        if (cancelled) return;
        objectUrl = u;
        setGuardianPhotoUrl(u);
      }).catch(() => {});
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [employee.id, employee.guardianPhotoPath]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    if (employee.nomineePhotoPath) {
      fetchFileBlobUrl(`/employees/${employee.id}/nominee-photo`).then((u) => {
        if (cancelled) return;
        objectUrl = u;
        setNomineePhotoUrl(u);
      }).catch(() => {});
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [employee.id, employee.nomineePhotoPath]);

  async function onViewDoc(docId: string) {
    await viewFile(`/employees/${employee.id}/documents/${docId}`);
  }

  // Only show the "Others Detail" section at all when at least one field
  // has actually been filled in — most employees may have none yet.
  const hasOtherDetail = !!(
    employee.fatherName || employee.motherName || employee.birthDate || employee.passportNumber ||
    employee.nationality || employee.originCountryIdNumber || employee.homeAddress ||
    employee.educationalQualifications || employee.skills || employee.certifications ||
    employee.guardianName || employee.guardianPhone || employee.guardianNationalId ||
    employee.guardianRelationship || employee.guardianAddress || employee.emergencyPhone1 ||
    employee.emergencyPhone2 || employee.guardianPhotoPath || employee.nomineeName ||
    employee.nomineeNationalId || employee.nomineePhone || employee.nomineeRelationship || employee.nomineePhotoPath
  );

  return (
    <Modal title="Employee details" onClose={onClose} wide>
      <div className="flex items-start gap-4 mb-4">
        <EmployeePhoto employeeId={employee.id} hasPhoto={!!employee.photoPath} size={80} />
        <div>
          <div className="text-base font-semibold text-ink flex items-center gap-1.5">
            <CountryFlag code={employee.nationality} size={18} />
            {employee.name}
            {employee.biometricId && (
              <span title="Fingerprint enrolled" className="text-brand-600">
                <Fingerprint size={14} />
              </span>
            )}
          </div>
          <div className="text-sm text-muted">{roleLabel(employee.role)}</div>
          {!employee.active && (
            <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-black/5 text-ink/60 font-medium">Inactive</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-5 text-sm">
        <div>
          <div className="text-xs text-muted">Staff ID</div>
          <div className="text-ink">{employee.staffId || '-'}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Department</div>
          <div className="text-ink">{employee.department || '-'}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Team</div>
          <div className="text-ink">{employee.team || '-'}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Shift</div>
          <div className="text-ink">{employee.shift || '-'}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Basic salary</div>
          <div className="text-ink">{employee.baseSalary != null ? Number(employee.baseSalary).toFixed(3) : '-'}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Allowances (housing / transport / other)</div>
          <div className="text-ink">
            {Number(employee.housingAllowance || 0).toFixed(3)} / {Number(employee.transportAllowance || 0).toFixed(3)} / {Number(employee.otherAllowance || 0).toFixed(3)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted">Social Protection Fund</div>
          <div className="text-ink">{employee.socialProtectionCovered ? 'Covered (no gratuity)' : 'Not covered (gratuity accrues)'}</div>
        </div>
        {employee.leftDate && (
          <div>
            <div className="text-xs text-muted">Last working day</div>
            <div className="text-ink">{employee.leftDate}</div>
          </div>
        )}
        <div>
          <div className="text-xs text-muted">OT Rate (per hour)</div>
          <div className="text-ink">
            {effectiveOtRate != null ? Number(effectiveOtRate).toFixed(2) : '-'}
            {effectiveOtRate != null && employee.otRatePerHour == null && (
              <span className="text-xs text-muted"> (department default)</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted">Joined date</div>
          <div className="text-ink">{employee.joinedDate || '-'}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Employment Type</div>
          <div className="text-ink">{labelFor(EMPLOYMENT_TYPE_OPTIONS, employee.employmentType)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Status</div>
          <div className="text-ink">{labelFor(EMPLOYEE_STATUS_OPTIONS, employee.status)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Phone</div>
          <div className="text-ink">{employee.phone || '-'}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Email</div>
          <div className="text-ink">{employee.email || '-'}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Biometric ID</div>
          <div className="text-ink">{employee.biometricId || '-'}</div>
        </div>
      </div>

      <div>
        <span className="block text-xs font-medium text-muted mb-2">Attached documents</span>
        {docsLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted">No documents attached yet.</p>
        ) : (
          <div className="divide-y divide-black/5 border border-black/10 rounded-lg">
            {docs.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onViewDoc(d.id)}
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-black/5"
              >
                <div>
                  <div className="text-sm text-ink">{d.label}</div>
                  <div className="text-xs text-muted">{d.originalName}</div>
                </div>
                <Eye size={15} className="text-muted" />
              </button>
            ))}
          </div>
        )}
      </div>

      {hasOtherDetail && (
        <div className="mt-5 pt-4 border-t border-black/10">
          <span className="block text-xs font-medium text-muted mb-2">Others Detail</span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-4 text-sm">
            <div>
              <div className="text-xs text-muted">Father's Name</div>
              <div className="text-ink">{employee.fatherName || '-'}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Mother's Name</div>
              <div className="text-ink">{employee.motherName || '-'}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Birth Date</div>
              <div className="text-ink">{employee.birthDate || '-'}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Passport Number</div>
              <div className="text-ink">{employee.passportNumber || '-'}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Nationality</div>
              <div className="text-ink flex items-center gap-1.5">
                {employee.nationality ? (
                  <>
                    <CountryFlag code={employee.nationality} /> {countryName(employee.nationality)}
                  </>
                ) : (
                  '-'
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Origin Country ID Number</div>
              <div className="text-ink">{employee.originCountryIdNumber || '-'}</div>
            </div>
            <div className="col-span-2">
              <div className="text-xs text-muted">Home Address</div>
              <div className="text-ink whitespace-pre-wrap">{employee.homeAddress || '-'}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Educational Qualifications</div>
              <div className="text-ink">{employee.educationalQualifications || '-'}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Skills</div>
              <div className="text-ink">{employee.skills || '-'}</div>
            </div>
            <div className="col-span-2">
              <div className="text-xs text-muted">Certifications</div>
              <div className="text-ink">{employee.certifications || '-'}</div>
            </div>
          </div>

          {(employee.guardianName || employee.guardianPhone || employee.guardianNationalId || employee.guardianRelationship ||
            employee.guardianAddress || employee.emergencyPhone1 || employee.emergencyPhone2 || employee.guardianPhotoPath) && (
            <div className="mb-4">
              <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Wife / Guardian</div>
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-lg border border-black/10 bg-black/5 flex items-center justify-center overflow-hidden shrink-0">
                  {guardianPhotoUrl ? (
                    <img src={guardianPhotoUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <User size={20} className="text-muted" />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm flex-1">
                  <div>
                    <div className="text-xs text-muted">Name</div>
                    <div className="text-ink">{employee.guardianName || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Phone Number</div>
                    <div className="text-ink">{employee.guardianPhone || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">National ID Number</div>
                    <div className="text-ink">{employee.guardianNationalId || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Relationship</div>
                    <div className="text-ink">{employee.guardianRelationship || '-'}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-xs text-muted">Address</div>
                    <div className="text-ink whitespace-pre-wrap">{employee.guardianAddress || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Emergency Phone 1</div>
                    <div className="text-ink">{employee.emergencyPhone1 || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Emergency Phone 2</div>
                    <div className="text-ink">{employee.emergencyPhone2 || '-'}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {(employee.nomineeName || employee.nomineeNationalId || employee.nomineePhone || employee.nomineeRelationship ||
            employee.nomineePhotoPath) && (
            <div>
              <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Nominee</div>
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-lg border border-black/10 bg-black/5 flex items-center justify-center overflow-hidden shrink-0">
                  {nomineePhotoUrl ? (
                    <img src={nomineePhotoUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <User size={20} className="text-muted" />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm flex-1">
                  <div>
                    <div className="text-xs text-muted">Name</div>
                    <div className="text-ink">{employee.nomineeName || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">National ID / Birth Certificate Number</div>
                    <div className="text-ink">{employee.nomineeNationalId || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Phone Number</div>
                    <div className="text-ink">{employee.nomineePhone || '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Relationship</div>
                    <div className="text-ink">{employee.nomineeRelationship || '-'}</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end pt-4">
        <SecondaryButton onClick={onClose}>Close</SecondaryButton>
      </div>
    </Modal>
  );
}

function EmployeeDocumentsModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const [docs, setDocs] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function load() {
    setLoading(true);
    api.get(`/employees/${employee.id}/documents`).then((res) => setDocs(res.data)).finally(() => setLoading(false));
  }

  useEffect(load, [employee.id]);

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (!file || !label.trim()) return;
    setBusy(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('label', label.trim());
      await api.post(`/employees/${employee.id}/documents`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setLabel('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not upload the document.');
    } finally {
      setBusy(false);
    }
  }

  async function onView(docId: string) {
    await viewFile(`/employees/${employee.id}/documents/${docId}`);
  }

  async function onDelete(docId: string) {
    if (!window.confirm('Remove this document? This cannot be undone.')) return;
    await api.delete(`/employees/${employee.id}/documents/${docId}`);
    load();
  }

  return (
    <Modal title={`Documents — ${employee.name}`} onClose={onClose} wide>
      <Can>
      <form onSubmit={onUpload} className="flex items-end gap-2 mb-3">
        <div className="flex-1">
          <Field label="Document type">
            <input
              className={inputClass}
              list="doc-label-suggestions"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Residence ID"
            />
            <datalist id="doc-label-suggestions">
              {DOCUMENT_LABEL_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <SecondaryButton icon={Upload} onClick={() => fileInputRef.current?.click()}>
            {file ? file.name.slice(0, 18) : 'Choose file'}
          </SecondaryButton>
        </div>
        <PrimaryButton type="submit" disabled={busy || !file || !label.trim()} requires="edit">
          {busy ? 'Uploading…' : 'Add'}
        </PrimaryButton>
      </form>
      </Can>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-muted">No documents attached yet — Residence ID, Passport, Visa, and more can go here.</p>
      ) : (
        <div className="divide-y divide-black/5 border border-black/10 rounded-lg">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between px-3 py-2">
              <div>
                <div className="text-sm text-ink">{d.label}</div>
                <div className="text-xs text-muted">
                  {d.originalName} · {new Date(d.uploadedAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <IconButton icon={Download} title="View / download" onClick={() => onView(d.id)} />
                <IconButton icon={Trash2} tone="danger" title="Remove" onClick={() => onDelete(d.id)} requires="full" />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end pt-3">
        <SecondaryButton onClick={onClose}>Close</SecondaryButton>
      </div>
    </Modal>
  );
}

function ManageListModal({
  title,
  items,
  createPath,
  deletePath,
  onClose,
  onChanged,
}: {
  title: string;
  items: RoleOrTeam[];
  createPath: string;
  deletePath: (id: string) => string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post(createPath, { name: name.trim() });
      setName('');
      onChanged();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not add.');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm('Remove this? Employees already using it keep the name, but it will disappear from the dropdown.')) return;
    await api.delete(deletePath(id));
    onChanged();
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={onAdd} className="flex items-end gap-2 mb-3">
        <div className="flex-1">
          <Field label="New name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Store Manager" />
          </Field>
        </div>
        <PrimaryButton type="submit" disabled={busy || !name.trim()} requires="edit">Add</PrimaryButton>
      </form>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      {items.length === 0 ? (
        <p className="text-sm text-muted">Nothing added yet.</p>
      ) : (
        <div className="divide-y divide-black/5 border border-black/10 rounded-lg">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between px-3 py-2">
              <span className="text-sm text-ink">{roleLabel(item.name)}</span>
              <IconButton icon={Trash2} tone="danger" title="Remove" onClick={() => onDelete(item.id)} requires="full" />
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end pt-3">
        <SecondaryButton onClick={onClose}>Close</SecondaryButton>
      </div>
    </Modal>
  );
}

function MarkAttendanceModal({
  employees,
  date,
  defaultWeeklyOff,
  record,
  onClose,
  onSaved,
}: {
  employees: Employee[];
  date: string;
  defaultWeeklyOff?: boolean;
  // When set, the modal opens in edit mode for this existing record —
  // Employee is locked (attendance is one record per employee per day,
  // keyed by employeeId+date, so changing it here would edit/create a
  // different record instead) and every field is pre-filled.
  record?: AttendanceRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [employeeId, setEmployeeId] = useState(
    record?.employeeId || employees.find((e) => !e.archiveType)?.id || '',
  );
  const [status, setStatus] = useState(record?.status || (defaultWeeklyOff ? 'weekend' : 'present'));
  const [checkIn, setCheckIn] = useState(record?.checkIn || '');
  const [checkOut, setCheckOut] = useState(record?.checkOut || '');
  const [lunchIn, setLunchIn] = useState(record?.lunchIn || '');
  const [lunchOut, setLunchOut] = useState(record?.lunchOut || '');
  const [breakMinutes, setBreakMinutes] = useState(record?.breakMinutes != null ? String(record.breakMinutes) : '');
  const [overtimeHours, setOvertimeHours] = useState(record?.overtimeHours != null ? String(record.overtimeHours) : '');
  const [notes, setNotes] = useState(record?.notes || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/attendance', {
        employeeId,
        date,
        status,
        checkIn: checkIn || undefined,
        checkOut: checkOut || undefined,
        lunchIn: lunchIn || undefined,
        lunchOut: lunchOut || undefined,
        breakMinutes: breakMinutes ? Number(breakMinutes) : undefined,
        notes: notes || undefined,
        overtimeHours: overtimeHours ? Number(overtimeHours) : undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={record ? `Edit attendance — ${date}` : `Mark attendance — ${date}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        {defaultWeeklyOff && (
          <p className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            This date is a configured weekly off day.
          </p>
        )}
        <Field label="Employee">
          <select
            className={inputClass}
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            disabled={!!record}
            required
          >
            {/* Archived (Old/Temporary) employees are hidden here for a new
                entry — but if this is editing an existing record for one
                (the select is disabled in that case anyway), keep their
                name selectable so the locked value still shows correctly. */}
            {employees
              .filter((e) => !e.archiveType || e.id === employeeId)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Status">
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            {ATTENDANCE_STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Check-in (optional)">
            <input className={inputClass} type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
          </Field>
          <Field label="Check-out (optional)">
            <input className={inputClass} type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-muted -mt-1.5">
          Status and overtime are auto-calculated from check-in/check-out against the shift times set in Settings.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lunch in (optional)">
            <input className={inputClass} type="time" value={lunchIn} onChange={(e) => setLunchIn(e.target.value)} />
          </Field>
          <Field label="Lunch out (optional)">
            <input className={inputClass} type="time" value={lunchOut} onChange={(e) => setLunchOut(e.target.value)} />
          </Field>
        </div>
        <Field label="Break (minutes, optional)">
          <input
            className={inputClass}
            type="number"
            min="0"
            step="1"
            value={breakMinutes}
            onChange={(e) => setBreakMinutes(e.target.value)}
            placeholder="e.g. 30"
          />
        </Field>
        <Field label="Overtime hours (optional)">
          <input
            className={inputClass}
            type="number"
            step="0.25"
            min="0"
            value={overtimeHours}
            onChange={(e) => setOvertimeHours(e.target.value)}
            placeholder="e.g. 2.5"
          />
        </Field>
        <p className="text-xs text-muted -mt-1.5">
          Used only as a fallback when there's no check-out to calculate from — a check-out overrides this.
        </p>
        <Field label="Notes (optional)">
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy} requires="edit">{busy ? 'Saving…' : 'Save'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

// app/lib/mock-data.ts — used for UI pages that don't yet have live data
export type AccessMethod = "qr" | "face";
export type UserRole = "Admin" | "Manager" | "Employee" | "Visitor";
export type UserStatus = "Active" | "Inactive" | "Suspended";

export interface VaultUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  status: UserStatus;
  methods: Record<AccessMethod, boolean>;
  lastSeen: string;
}

export const users: VaultUser[] = [
  { id: "u1", name: "Ava Chen", email: "ava.chen@vault.io", role: "Admin", department: "Security", status: "Active",
    methods: { qr: true, face: true }, lastSeen: "2 min ago" },
  { id: "u2", name: "Marcus Reed", email: "marcus.reed@vault.io", role: "Manager", department: "Operations", status: "Active",
    methods: { qr: false, face: true }, lastSeen: "14 min ago" },
  { id: "u3", name: "Priya Patel", email: "priya.patel@vault.io", role: "Employee", department: "Engineering", status: "Active",
    methods: { qr: true, face: true }, lastSeen: "1 hr ago" },
  { id: "u4", name: "Diego Alvarez", email: "diego@vault.io", role: "Employee", department: "Design", status: "Active",
    methods: { qr: true, face: true }, lastSeen: "3 hr ago" },
  { id: "u5", name: "Hannah Müller", email: "hannah.m@vault.io", role: "Visitor", department: "Guest", status: "Suspended",
    methods: { qr: true, face: false }, lastSeen: "Yesterday" },
  { id: "u6", name: "Tomás Silva", email: "tomas.s@vault.io", role: "Employee", department: "Finance", status: "Inactive",
    methods: { qr: false, face: false }, lastSeen: "5 days ago" },
  { id: "u7", name: "Naomi Brooks", email: "naomi.b@vault.io", role: "Manager", department: "HR", status: "Active",
    methods: { qr: true, face: true }, lastSeen: "22 min ago" },
];

export type ActivityStatus = "granted" | "denied" | "alert";
export interface Activity {
  id: string;
  userId: string;
  userName: string;
  action: "Entry" | "Exit";
  time: string;
  status: ActivityStatus;
  location: string;
  method: AccessMethod;
}

export const recentActivity: Activity[] = [
  { id: "a1", userId: "u1", userName: "Ava Chen", action: "Entry", time: "09:42 AM", status: "granted", location: "Main Entrance", method: "face" },
  { id: "a2", userId: "u2", userName: "Marcus Reed", action: "Entry", time: "09:38 AM", status: "granted", location: "Server Room", method: "face" },
  { id: "a3", userId: "u5", userName: "Hannah Müller", action: "Entry", time: "09:31 AM", status: "denied", location: "Main Entrance", method: "qr" },
  { id: "a4", userId: "u3", userName: "Priya Patel", action: "Exit", time: "09:25 AM", status: "granted", location: "Side Door", method: "qr" },
  { id: "a5", userId: "u7", userName: "Naomi Brooks", action: "Entry", time: "09:18 AM", status: "granted", location: "Main Entrance", method: "face" },
  { id: "a6", userId: "u4", userName: "Diego Alvarez", action: "Entry", time: "09:02 AM", status: "alert", location: "Loading Dock", method: "qr" },
];

export const accessLogs: Activity[] = [
  ...recentActivity,
  { id: "l7", userId: "u2", userName: "Marcus Reed", action: "Exit", time: "Yesterday 06:14 PM", status: "granted", location: "Main Entrance", method: "face" },
  { id: "l8", userId: "u3", userName: "Priya Patel", action: "Entry", time: "Yesterday 08:51 AM", status: "granted", location: "Main Entrance", method: "qr" },
  { id: "l9", userId: "u5", userName: "Hannah Müller", action: "Entry", time: "Yesterday 02:30 PM", status: "denied", location: "Server Room", method: "qr" },
  { id: "l10", userId: "u1", userName: "Ava Chen", action: "Entry", time: "Yesterday 08:45 AM", status: "granted", location: "Main Entrance", method: "face" },
];

export interface TempCode {
  id: string;
  code: string;
  location: string;
  accessType: string;
  validFrom: string;
  expires: string;
  status: "Active" | "Used" | "Expired";
  notes?: string;
}

export const tempCodes: TempCode[] = [
  { id: "t1", code: "VLT-7H2K-9M4P", location: "Main Entrance", accessType: "Visitor", validFrom: "Today 09:00", expires: "Today 17:00", status: "Active", notes: "Contractor visit" },
  { id: "t2", code: "VLT-3F8L-2X1Q", location: "Server Room", accessType: "Maintenance", validFrom: "Today 08:00", expires: "Today 12:00", status: "Used" },
  { id: "t3", code: "VLT-9D4N-6T3R", location: "Side Door", accessType: "Delivery", validFrom: "Yesterday", expires: "Yesterday", status: "Expired" },
];

export function avatarInitials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export function avatarHue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

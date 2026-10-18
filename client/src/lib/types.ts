export type User = {
  id: string;
  username: string;
  displayName: string;
  accent: string;
  bio: string;
  statusText: string;
  isAdmin?: boolean;
};

export type CommunitySummary = { id: string; name: string; accent: string; description: string };

export type Channel = {
  id: string;
  name: string;
  kind: 'text' | 'voice' | 'announcement';
  category: string;
  topic: string;
  position: number;
};

export type Role = {
  id: string;
  name: string;
  color: string;
  permissions: string;
  position: number;
  isDefault: boolean;
};

export type Member = {
  id: string;
  username: string;
  displayName: string;
  accent: string;
  statusText: string;
  roleIds: string[];
  online: boolean;
};

export type Community = {
  id: string;
  name: string;
  description: string;
  accent: string;
  ownerId: string;
  myPermissions: string;
  channels: Channel[];
  roles: Role[];
  members: Member[];
  voice: Record<string, string[]>;
};

export type Message = {
  id: string;
  channelId: string | null;
  dmId: string | null;
  content: string;
  createdAt: string;
  editedAt: string | null;
  author: { id: string; username: string; displayName: string; accent: string };
  pending?: boolean;
};

export type DmThread = {
  id: string;
  lastMessageAt: string | null;
  user: User & { online: boolean };
};

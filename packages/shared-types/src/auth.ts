export interface LoginRequest {
  email: string;
  password: string;
  tenantSlug: string;
}

export interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    tenantId: string;
    role: string;
  };
}

export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  roleId: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}

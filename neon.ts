import { defineConfig } from '@neon/config/v1';

// CrackPOS needs only Lakebase Postgres (DATABASE_URL for Prisma).
// Neon Auth is intentionally NOT enabled: CrackPOS already ships its own
// auth (JWT + HttpOnly cookies + bcrypt, multi-tenant), so Neon Auth would
// just add unused user/session tables.
export default defineConfig({
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: '7d' };
    }
    // Existing branch: no changes
    return {};
  },
});

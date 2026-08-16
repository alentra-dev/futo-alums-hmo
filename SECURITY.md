# Security

Do not report vulnerabilities in a public issue. Contact the repository owner privately through GitHub.

Never commit enrollment records, payment proofs, bank details, Supabase service-role keys, database passwords, or generated AVON exports. The browser may use only the Supabase publishable key. Authorization is enforced by Postgres row-level security and server functions, not by hidden frontend controls.

Before a production release:

1. Apply every migration under `supabase/migrations`.
2. Run the private importer from a trusted workstation.
3. Verify row-level policies using subscriber, administrator, and owner test accounts.
4. Set Supabase Auth redirect URLs to the deployed Pages URL.
5. Review the privacy notice with a Nigerian data-protection professional.

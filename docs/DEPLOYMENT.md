# Deploying V.A.U.L.T to Cloudflare

V.A.U.L.T is designed to run entirely on Cloudflare's serverless ecosystem, ensuring zero-maintenance, global edge caching, and a generous free tier. This guide covers how to deploy the database (D1), object storage (R2), and the API + Frontend (Cloudflare Pages).

## Prerequisites

1.  A [Cloudflare account](https://dash.cloudflare.com/sign-up).
2.  [Node.js](https://nodejs.org/) installed on your machine.
3.  Cloudflare's CLI, `wrangler`, authenticated on your machine:
    ```bash
    npx wrangler login
    ```

## 1. Create the D1 Database

Cloudflare D1 is our serverless SQL database.

1.  Create the database:
    ```bash
    npx wrangler d1 create vault-db
    ```
2.  The CLI will output a `database_id`. Open `wrangler.toml` and update the `database_id` field under `[[d1_databases]]` with this value.
3.  Apply the database schema to the production database:
    ```bash
    pnpm db:push --remote
    ```
    *(Alternatively, use `pnpm db:migrate` if you are using drizzle migrations).*

## 2. Set up Supabase Storage

We use Supabase Storage for saving doorbell captures and face enrollments.

1.  Create a project on [Supabase](https://supabase.com/).
2.  Go to Storage and create a new bucket named `vault-images`.
3.  Ensure the bucket is configured to accept image uploads. The backend uses the Service Role Key to manage files, so the bucket doesn't need to be public.

## 3. Configure Secrets

The application requires a few environment variables to function properly. You must set these in your Cloudflare project as encrypted secrets:

```bash
# Used for encrypting session cookies
npx wrangler pages secret put SESSION_SECRET

# Used by the ESP32 hardware to authenticate API requests
npx wrangler pages secret put CAMERA_API_KEY

# Supabase Storage Configuration
npx wrangler pages secret put SUPABASE_URL
npx wrangler pages secret put SUPABASE_SECRET_KEY

# (Optional) Face++ Credentials if not configuring them via the Dashboard
npx wrangler pages secret put FACEPLUSPLUS_API_KEY
npx wrangler pages secret put FACEPLUSPLUS_API_SECRET

# Admin user details
npx wrangler pages secret put ADMIN_EMAIL
npx wrangler pages secret put ADMIN_PASSWORD
```

## 4. Deploy the Application

The V.A.U.L.T repository uses a unified build. Vite compiles the React frontend into `dist/`, and Cloudflare Pages automatically discovers and bundles the `functions/` directory into a Serverless API.

1.  Deploy to Cloudflare Pages using Wrangler:
    ```bash
    pnpm run deploy
    ```
    *(This runs `vite build` followed by `wrangler pages deploy dist`).*

2.  On the first deployment, you will be prompted to create a new project. Name it something like `vault-system`.

## 5. Post-Deployment

1.  Once deployed, navigate to your Cloudflare Dashboard -> Pages -> `vault-system` -> Settings -> Bindings.
2.  Ensure that your D1 Database (`DB`) and R2 Bucket (`IMAGES`) are correctly bound to the production environment.
3.  Visit your new `.pages.dev` domain in the browser.
4.  Log in using the default admin credentials, and change your password immediately.
5.  Configure your ESP32 in the hardware firmware to point to `https://your-app-name.pages.dev` and inject your `CAMERA_API_KEY`.

That's it! Your system is now running on the Edge.

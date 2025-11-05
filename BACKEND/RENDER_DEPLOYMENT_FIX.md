# Render Deployment Fix - Port Detection Issue

## Problem
Render shows: "No open ports detected, continuing to scan..."

This happens because the `run_setup.py` script (which runs in background) takes 5-10 minutes to process all 3246 ICD codes through the AI discovery script, and Render times out waiting for the port.

## Solution: Skip AI Discovery on Startup

### Step 1: Add Environment Variable in Render

1. Go to your **Render Dashboard**
2. Select your **Web Service** (AYUR-SYNC-API)
3. Go to the **Environment** tab
4. Click **Add Environment Variable**
5. Add:
   ```
   Key: SKIP_AI_DISCOVERY
   Value: true
   ```
6. Click **Save Changes**

### Step 2: Redeploy

Render will automatically redeploy with the new environment variable.

### Step 3: What Happens Now

✅ **Fast Startup** (10-30 seconds):
- Database connection established
- Tables created
- Server starts immediately
- Render detects port 8000 ✓

✅ **Populate Data On-Demand**:
- After deployment succeeds, open your admin panel
- Click the **"Overall Reset"** button
- This will run the AI discovery in the background
- You can monitor progress in the modal

---

## Alternative: Keep Discovery on Startup (Not Recommended for Free Tier)

If you want discovery to run on every deployment:

1. Remove the `SKIP_AI_DISCOVERY` environment variable
2. In Render → **Settings** → **Health Check**:
   - Set **Health Check Path**: `/health` (create this endpoint)
   - Set **Initial Delay**: 600 seconds (10 minutes)
3. Add a health endpoint to `app/main.py`:
   ```python
   @app.get("/health")
   def health_check():
       return {"status": "ok"}
   ```

⚠️ **Warning**: This approach:
- Takes 5-10 minutes on free tier (slow CPU)
- Might still timeout
- Delays every deployment
- Better to use Option 1 and populate on-demand

---

## Required Environment Variables in Render

Make sure you have these set:

```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
GEMINI_API_KEY=your_key_here
SECRET_KEY=your_secret_key_here
SKIP_AI_DISCOVERY=true
DEV_MODE=0
```

## Verify Deployment Success

After deployment, check:

1. **Render Logs** show:
   ```
   [ENTRYPOINT] Starting API server...
   INFO: Started server process [1]
   INFO: Waiting for application startup.
   INFO: Application startup complete.
   INFO: Uvicorn running on http://0.0.0.0:8000
   ```

2. **Visit your service URL** - you should see the API docs at:
   ```
   https://your-service.onrender.com/docs
   ```

3. **Admin Panel** - Configure it to point to your Render API URL

---

## Troubleshooting

### Still seeing "No open ports"?

1. Check Render logs for errors
2. Verify DATABASE_URL is correct
3. Make sure the database service is running
4. Check that `SKIP_AI_DISCOVERY=true` is set

### Want to run discovery manually?

1. Access your admin panel
2. Login with credentials
3. Click "Overall Reset" button
4. Confirm with "RESET ALL"
5. Monitor progress in the modal at bottom of screen

---

## Summary

✅ **Best Practice for Render Free Tier**:
- Set `SKIP_AI_DISCOVERY=true`
- Let service start quickly
- Populate data via admin panel after deployment
- Faster deployments, no timeouts

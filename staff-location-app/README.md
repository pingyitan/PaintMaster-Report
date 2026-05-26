# Staff Location Viewer

Local web app for staff to view only their assigned location report.

The main page shows exported Excel report PDFs:

```text
C:\Users\admin\Documents\report\staff_view\MB.pdf
C:\Users\admin\Documents\report\staff_view\SA.pdf
C:\Users\admin\Documents\report\staff_view\BA.pdf
C:\Users\admin\Documents\report\staff_view\BR.pdf
```

## Optional Data File

The `/data` page first looks for this file:

```text
C:\Users\admin\Documents\report\staff_view_data.csv
```

If that file is missing, it uses the sample file inside:

```text
data\staff_view_data.csv
```

Required columns:

```text
Date,Weekday,Work,Location,Month
```

`Work` should be:

```text
1 = open
0 = close
```

## Start App

Open Command Prompt in this folder and run:

```cmd
npm start
```

## Cloud Upload

Set these environment variables on the cloud server:

```text
UPLOAD_KEY=change-this-to-a-long-secret
REPORT_DIR=/var/data/staff_view
```

Upload PDFs from the shop PC:

```powershell
powershell -ExecutionPolicy Bypass -File .\UploadReportsToCloud.ps1 -AppUrl "https://your-app.onrender.com" -UploadKey "change-this-to-a-long-secret"
```

Then open:

```text
http://localhost:3000
```

Other devices in the same shop Wi-Fi can open:

```text
http://YOUR-PC-IP:3000
```

## Default Login

Change these passwords before real use in `config\users.json`.

```text
admin / admin123 -> all locations
mb / mb123 -> MB only
sa / sa123 -> SA only
ba / ba123 -> BA only
br / br123 -> BR only
```

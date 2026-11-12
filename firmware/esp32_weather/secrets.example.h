#pragma once

// Copy this file to secrets.h and fill it in. secrets.h is gitignored.

#define WIFI_SSID "your-2.4ghz-network"
#define WIFI_PASSWORD "your-wifi-password"

// Your Vercel deployment plus the readings endpoint.
#define API_URL "https://your-project.vercel.app/api/readings"

// Must match the SENSOR_API_KEY environment variable in Vercel.
#define SENSOR_API_KEY "paste-your-sensor-key-here"

// Shows up in the dashboard's "Indoor sensor" card.
#define DEVICE_ID "esp32-1"

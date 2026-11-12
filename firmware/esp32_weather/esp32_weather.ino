/*
 * ESP32 -> Vercel -> Neon
 *
 * Reads a DHT22 every 5 seconds and POSTs the temperature and humidity to
 * /api/readings, where they are stored in Neon and shown on the dashboard.
 *
 * Libraries (Arduino IDE -> Library Manager):
 *   - "DHT sensor library" by Adafruit
 *   - "Adafruit Unified Sensor"
 *
 * Wiring (DHT22):
 *   VCC  -> 3V3
 *   DATA -> GPIO 4 (add a 10k pull-up from DATA to VCC)
 *   GND  -> GND
 *
 * Copy secrets.example.h to secrets.h and fill in your Wi-Fi and endpoint.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <DHT.h>

#include "secrets.h"

#define DHTPIN 4
#define DHTTYPE DHT22

const unsigned long POST_INTERVAL_MS = 5000;

DHT dht(DHTPIN, DHTTYPE);
WiFiClientSecure secureClient;

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.printf("Connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Connected: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Wi-Fi not connected, will retry.");
  }
}

bool postReading(float temperature, float humidity) {
  if (WiFi.status() != WL_CONNECTED) return false;

  // Simplest TLS setup for a class project. For production, pin a CA with
  // secureClient.setCACert(rootCA) instead of setInsecure().
  secureClient.setInsecure();

  HTTPClient http;
  if (!http.begin(secureClient, API_URL)) {
    Serial.println("Could not open HTTP connection.");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-sensor-key", SENSOR_API_KEY);

  String payload = "{\"temperature\":" + String(temperature, 2) +
                   ",\"humidity\":" + String(humidity, 2) +
                   ",\"deviceId\":\"" + DEVICE_ID + "\"}";

  int status = http.POST(payload);
  String response = http.getString();
  http.end();

  if (status == 201) {
    Serial.printf("Saved %.1f C / %.1f %% (HTTP %d)\n", temperature, humidity, status);
    return true;
  }

  Serial.printf("POST failed (HTTP %d): %s\n", status, response.c_str());
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(200);
  dht.begin();
  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    delay(POST_INTERVAL_MS);
    return;
  }

  float temperature = dht.readTemperature(); // Celsius
  float humidity = dht.readHumidity();

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("DHT read failed, check the wiring.");
  } else {
    postReading(temperature, humidity);
  }

  delay(POST_INTERVAL_MS);
}

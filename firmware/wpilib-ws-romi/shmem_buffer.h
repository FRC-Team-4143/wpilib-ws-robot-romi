// AUTOGENERATED FILE. DO NOT MODIFY.
// Generated via `npm run gen-shmem`

// Instance: 11b7afe5-5601-4675-afcf-2b6293ea7386

#pragma once
#include <stdint.h>

struct Data {
  bool heartbeat;
  uint8_t builtinConfig;
  bool builtinDioValues[4];
  bool dio8Input;
  bool dio8Value;
  uint16_t analog[2];
  int16_t pwm[4];
  uint16_t batteryMillivolts;
  bool resetLeftEncoder;
  bool resetRightEncoder;
  int16_t leftEncoder;
  int16_t rightEncoder;
};
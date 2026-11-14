#!/usr/bin/env bash
# Logs battery, temperatures, throttling state and CPU clocks from the phone every few
# seconds, for the paper's battery-and-heat measurement (Section VI-F, item v) and to test
# whether latency variation is thermal throttling (item i, review comment 3).
#
#   bash scripts/device-monitor.sh device.csv [interval_seconds]
#
# Stop with Ctrl-C. For the battery test the phone must not be charging: connect with
# wireless debugging (`adb pair` / `adb connect`), not a USB cable, or the readings
# will be wrong. The report flags any reading taken on power.
#
# Everything comes from one `adb shell` call per reading, timed by the PHONE's clock, so
# rows line up with the app's frame timestamps (also phone `Date.now()`) without any
# laptop-to-phone clock skew.
#
# Sources, all readable without root on begoniain (Android 11):
#   dumpsys thermalservice  "Current temperatures from HAL": CPU and SKIN in degrees C,
#                           "Thermal Status" (0 none .. 6 shutdown), and the cooling
#                           devices: any cpu* cooling device above 0 means the thermal
#                           framework is capping the CPU right now.
#   /sys/.../cpuN/cpufreq   scaling_cur_freq of cpu0 (little cluster) and cpu6 (big).
# /sys/class/thermal is permission-denied on this phone, which is why dumpsys is used.
set -euo pipefail
out="${1:?usage: device-monitor.sh out.csv [interval_seconds]}"
every="${2:-10}"

# Runs on the phone. Prints one CSV row.
read -r -d '' probe <<'EOF' || true
b=$(dumpsys battery)
t=$(dumpsys thermalservice)
field() { echo "$b" | grep -m1 "$1" | sed 's/.*: //' | tr -d '\r '; }
level=$(field ' level:')
btemp=$(field ' temperature:')
ac=$(field 'AC powered:'); usb=$(field 'USB powered:')
plugged=0; [ "$ac" = true ] && plugged=1; [ "$usb" = true ] && plugged=1
hal=$(echo "$t" | sed -n '/Current temperatures from HAL/,/Current cooling devices/p')
temp_of() { echo "$hal" | grep -m1 "mName=$1," | sed 's/.*mValue=\([0-9.]*\).*/\1/'; }
cpu=$(temp_of CPU); skin=$(temp_of SKIN)
status=$(echo "$t" | grep -m1 'Thermal Status:' | sed 's/.*: //' | tr -d '\r ')
cool=$(echo "$t" | sed -n '/Current cooling devices from HAL/,$p' | grep 'mName=cpu' | sed 's/.*mValue=\([0-9]*\).*/\1/' | sort -n | tail -1)
f0=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null)
f6=$(cat /sys/devices/system/cpu/cpu6/cpufreq/scaling_cur_freq 2>/dev/null)
echo "$(date +%s),$level,$((btemp / 10)).$((btemp % 10)),$plugged,$cpu,$skin,$status,${cool:-0},$f0,$f6"
EOF

echo "epoch_s,level,battery_temp_c,plugged,cpu_temp_c,skin_temp_c,thermal_status,cpu_cooling,freq_little_khz,freq_big_khz" > "$out"
while true; do
  adb shell "$probe" | tr -d '\r' | tee -a "$out"
  sleep "$every"
done

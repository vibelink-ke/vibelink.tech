#!/bin/sh
# Temporary diagnostic for the PPPoE MAC-lock check in sites-available/billing
# — appends exactly what authorize{} resolved for this attempt so we can see
# whether Tmp-String-0/Calling-Station-Id ever actually differ the way the
# database says they should. Args, not string interpolation, so nothing here
# depends on shell-quoting a value FreeRADIUS xlat'd from user-controlled
# input. Remove the call to this script (and this file) once the real bug is
# found — it is not meant to run forever.
echo "$(date -u +%FT%TZ) user=[$1] lock=[$2] calling=[$3]" >> /tmp/maccheck.log

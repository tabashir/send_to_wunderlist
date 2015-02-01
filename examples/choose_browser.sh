#!/usr/bin/env bash

URL_TO_MATCH="$@"
if [ -z "$1" ]; then
  echo "I can't match if you don't give me a param....."
  exit 1
fi

PREF_BROWSER="firefox"
ALT_BROWSER="google-chrome-stable chromium chromium-browser"

ALT_BROWSER_MATCHES="plus.google.com wunderlist.com hangout Hangout"
# ALT_BROWSER_MATCHES="plus.google.com wunderlist.com"

function locate_progs {
  for name in $1; do
    local POSS=$(which $name 2>/dev/null)
    if [ -n "$POSS" ];then
      echo $POSS
      return 0
    fi
  done
  echo "cannot find any one of: $1"
  exit 1
}

function call_tb_if_thunderlink {
	local TL_STRING="http://thunderlink.me/"
	local IS_TL=$(echo "$URL_TO_MATCH" |grep "$TL_STRING" )
    echo $IS_TL
    if [ -z "$IS_TL" ]; then
			echo $URL_TO_MATCH
		else
			TL=$(echo $URL_TO_MATCH | sed "s#$TL_STRING#thunderlink://#")
			thunderbird -thunderlink "$TL"
			exit 0
    fi
}

function choose_browser {
  for possmatch in $ALT_BROWSER_MATCHES; do
    local POSS=$(echo "$URL_TO_MATCH" |grep "$possmatch" )
    echo $POSS
    if [ -n "$POSS" ]; then
      $("$LOCATED_ALT" "$URL_TO_MATCH")
      exit 0
    fi
  done
  $("$LOCATED_PREF" "$URL_TO_MATCH")
}

LOCATED_PREF=$(locate_progs "$PREF_BROWSER")
LOCATED_ALT=$(locate_progs "$ALT_BROWSER")

call_tb_if_thunderlink > /tmp/choose_browser.log 2>&1
choose_browser >> /tmp/choose_browser.log 2>&1 &



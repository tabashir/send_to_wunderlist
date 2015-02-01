#Send To Wunderlist (STW)

This is to enable you to forward emails to Wunderlist to create to-do items from your Thunderbird email with added Thunderlink support: https://addons.mozilla.org/en-US/thunderbird/addon/thunderlink/

This is based, but massively hacked from Enforward for Thunderbird - See: https://addons.mozilla.org/en-US/thunderbird/addon/enforward/

Enforward itself will allow you to send to wunderlist, you just need to use the 'send to onenote' functionality and change the email address. However I've also changed the following:

* wunderlist email doesn't support html parsing so the note text looks horrible. STW uses TB's coerceBodyToPlaintext to send plain text which is readable
* wunderlist email doesn't support attachments, so I've ripped that code out completely which should save performance and bandwidth
* STW will allow you to insert a thunderlink in the note title and/or in the note body
* removed a lot of the body parsing code
* removed all of the enforward code (I want STW to be focused on one app)

### TODO (future ideas)

* LOTS of refactoring - it's not pretty in there!
* remove reminder code completely (can't set reminder in wunderlist email)
* pick up tags from message and forward them in subject line
* archive mail after forwarding (I use the 'Custom Buttons' addon to forward then archive at the moment)



### A note on Thunderlinks

To use thunderlinks, you need to install it as a plugin, then register thunderlink:// in your mime preferences (see the instructions in the Thunderlink page). There are plugins for Firefox and Chrome that allow these to be clickable (Thunderlinkspotter and TextLink respectively).

However, neither of these seem to play nicely with thunderlinks as the divs that contain the links in wunderlist are themselves clickable and I guess there is some javascript somewhere that prevents them being recognised. The best I could do was to right-click the link and do 'open in new tab' which would then work as expected.

To make them clickable, they need to be recognised by the wunderlist script as web links, so need to be in the format http://something.xxx/[thunderlinkId]. I therefore made the thunderlink prefix configurable (it will default to 'thunderlink://' which is what it should be). In my case, I made the prefix 'http://thunderlink.me/'. 

I then made a script (scripts/choose_browser.sh) that I have registered for all http/https links. This originally was to force certain urls (hangouts etc) to chromium whilst keeping FF for my default. I added a function that will substitute 'thunderlink://' for 'http://thunderlink.me/' and call TB with the correct params. A massive hack but it does work. 

Any better ideas gratefully accepted!
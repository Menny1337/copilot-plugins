on browserName(browserKey)
	if browserKey is "chrome" then return "Google Chrome"
	if browserKey is "msedge" then return "Microsoft Edge"
	return ""
end browserName

on jsonBool(value)
	if value then return "true"
	return "false"
end jsonBool

on errorJson(errorCode, errorMessage)
	return "{\"ok\":false,\"error\":\"" & my jsonEscape(errorCode) & "\",\"message\":\"" & my jsonEscape(errorMessage) & "\"}"
end errorJson

on jsonEscape(value)
	set cleaned to ""
	-- A grapheme's id can be a list; filter individual code points instead.
	repeat with codePoint in (id of (value as text) as list)
		if codePoint is greater than or equal to 32 then set cleaned to cleaned & (character id codePoint)
	end repeat
	set value to my replaceText(cleaned, "\\", "\\\\")
	return my replaceText(value, quote, "\\\"")
end jsonEscape

on replaceText(value, needle, replacement)
	set AppleScript's text item delimiters to needle
	set parts to text items of value
	set AppleScript's text item delimiters to replacement
	set value to parts as text
	set AppleScript's text item delimiters to ""
	return value
end replaceText

on processIdFor(processName)
	tell application "System Events"
		if exists application process processName then
			return unix id of application process processName
		end if
	end tell
	return 0
end processIdFor

on windowExists(appName, windowId)
	tell application appName
		repeat with candidate in windows
			if (id of candidate as text) is windowId then return true
		end repeat
	end tell
	return false
end windowExists

on windowHasMarker(appName, windowId, expectedMarker)
	if expectedMarker is "" then return false
	tell application appName
		repeat with candidate in windows
			if (id of candidate as text) is windowId then
				repeat with candidateTab in «class CrTb» of candidate
					try
						if («class URL » of candidateTab as text) contains expectedMarker then return true
					end try
				end repeat
			end if
		end repeat
	end tell
	return false
end windowHasMarker

on identityMatches(appName, processName, windowId, expectedProcessId, expectedMarker)
	set actualProcessId to my processIdFor(processName)
	if actualProcessId is 0 then return {false, false, 0, false, false}
	set found to my windowExists(appName, windowId)
	set markerMatches to found and my windowHasMarker(appName, windowId, expectedMarker)
	set processMatches to expectedProcessId is not "" and actualProcessId is (expectedProcessId as integer)
	set matched to found and markerMatches and processMatches
	return {found, matched, actualProcessId, processMatches, markerMatches}
end identityMatches

on run argv
	if (count of argv) < 2 then return my errorJson("invalid-arguments", "Expected command and browser")
	set commandName to item 1 of argv
	set browserKey to item 2 of argv
	if commandName is not in {"list", "current", "mark", "foreground", "restore", "inspect", "discard", "close"} then
		return my errorJson("unknown-command", "Unknown command: " & commandName)
	end if
	set appName to my browserName(browserKey)
	if appName is "" then return my errorJson("unsupported-browser", "Browser must be chrome or msedge")
	set appProcess to appName
	if commandName is "restore" then
		if (count of argv) < 7 then return my errorJson("invalid-arguments", "restore requires window and previous-foreground identity")
	else if commandName is not "list" and commandName is not "current" then
		if (count of argv) < 5 then return my errorJson("invalid-arguments", commandName & " requires window identity")
	end if

	if commandName is "list" then
		set rows to {}
		set browserProcessId to my processIdFor(appProcess)
		if browserProcessId is 0 then return "[]"
		tell application appName
			repeat with candidate in windows
				set candidateTitle to name of candidate as text
				set end of rows to "{\"id\":\"" & (id of candidate as text) & "\",\"processId\":" & browserProcessId & ",\"title\":\"" & my jsonEscape(candidateTitle) & "\"}"
			end repeat
		end tell
		set AppleScript's text item delimiters to ","
		set payload to rows as text
		set AppleScript's text item delimiters to ""
		return "[" & payload & "]"
	end if

	if commandName is "current" then
		tell application "System Events"
			set frontProcess to first application process whose frontmost is true
			set frontName to name of frontProcess
			set frontProcessId to unix id of frontProcess
		end tell
		set frontId to ""
		if frontName is appProcess then
			tell application appName
				if (count of windows) > 0 then set frontId to id of front window as text
			end tell
		end if
		return "{\"processName\":\"" & my jsonEscape(frontName) & "\",\"processId\":" & frontProcessId & ",\"id\":\"" & frontId & "\"}"
	end if

	set windowId to item 3 of argv
	set expectedProcessId to item 4 of argv
	set expectedMarker to item 5 of argv

	if commandName is "inspect" or commandName is "mark" then
		set identity to my identityMatches(appName, appProcess, windowId, expectedProcessId, expectedMarker)
		set found to item 1 of identity
		set matched to item 2 of identity
		set actualProcessId to item 3 of identity
		set processMatches to item 4 of identity
		set markerMatches to item 5 of identity
		if commandName is "mark" then
			return "{\"exists\":" & my jsonBool(found) & ",\"matches\":" & my jsonBool(matched) & ",\"processMatches\":" & my jsonBool(processMatches) & ",\"markerMatches\":" & my jsonBool(markerMatches) & ",\"markerMayBeClosed\":true,\"actualProcessId\":" & actualProcessId & ",\"marked\":" & my jsonBool(matched) & "}"
		end if
		return "{\"exists\":" & my jsonBool(found) & ",\"matches\":" & my jsonBool(matched) & ",\"processMatches\":" & my jsonBool(processMatches) & ",\"markerMatches\":" & my jsonBool(markerMatches) & ",\"markerMayBeClosed\":true,\"actualProcessId\":" & actualProcessId & "}"
	end if

	if commandName is "foreground" then
		set identity to my identityMatches(appName, appProcess, windowId, expectedProcessId, expectedMarker)
		if not item 2 of identity then
			return "{\"exists\":" & my jsonBool(item 1 of identity) & ",\"matches\":false,\"focused\":false}"
		end if
		tell application appName
			set index of window id (windowId as integer) to 1
			activate
		end tell
		delay 0.25
		tell application appName to set focused to (id of front window as text) is windowId
		return "{\"exists\":true,\"matches\":true,\"focused\":" & my jsonBool(focused) & "}"
	end if

	if commandName is "restore" then
		set previousProcess to item 6 of argv
		set previousWindowId to item 7 of argv
		if previousProcess is appProcess and previousWindowId is not "" and my processIdFor(appProcess) is not 0 and my windowExists(appName, previousWindowId) then
			tell application appName
				set index of window id (previousWindowId as integer) to 1
				activate
			end tell
			return "{\"restored\":true}"
		end if
		tell application "System Events"
			if exists application process previousProcess then
				set frontmost of application process previousProcess to true
				return "{\"restored\":true}"
			end if
		end tell
		return "{\"restored\":false}"
	end if

	if commandName is "close" then
		set identity to my identityMatches(appName, appProcess, windowId, expectedProcessId, expectedMarker)
		set found to item 1 of identity
		set matched to item 2 of identity
		set actualProcessId to item 3 of identity
		set processMatches to item 4 of identity
		set markerMatches to item 5 of identity
		if not found then
			return "{\"exists\":false,\"matches\":false,\"closed\":true,\"alreadyClosed\":true}"
		end if
		if not matched then
			return "{\"exists\":true,\"matches\":false,\"processMatches\":" & my jsonBool(processMatches) & ",\"markerMatches\":" & my jsonBool(markerMatches) & ",\"markerMayBeClosed\":true,\"actualProcessId\":" & actualProcessId & ",\"closed\":false,\"alreadyClosed\":false}"
		end if
		tell application appName to close window id (windowId as integer)
		repeat 50 times
			if not my windowExists(appName, windowId) then exit repeat
			delay 0.1
		end repeat
		set stillExists to my windowExists(appName, windowId)
		return "{\"exists\":" & my jsonBool(stillExists) & ",\"matches\":true,\"actualProcessId\":" & actualProcessId & ",\"closed\":" & my jsonBool(not stillExists) & ",\"alreadyClosed\":false}"
	end if

	if commandName is "discard" then
		set actualProcessId to my processIdFor(appProcess)
		if actualProcessId is 0 then return "{\"exists\":false,\"matches\":false,\"closed\":true}"
		set found to my windowExists(appName, windowId)
		set safeToDiscard to found and expectedProcessId is not "" and actualProcessId is (expectedProcessId as integer) and my windowHasMarker(appName, windowId, expectedMarker)
		if not safeToDiscard then
			return "{\"exists\":" & my jsonBool(found) & ",\"matches\":false,\"closed\":false}"
		end if
		tell application appName to close window id (windowId as integer)
		repeat 50 times
			if not my windowExists(appName, windowId) then exit repeat
			delay 0.1
		end repeat
		set stillExists to my windowExists(appName, windowId)
		return "{\"exists\":" & my jsonBool(stillExists) & ",\"matches\":true,\"closed\":" & my jsonBool(not stillExists) & "}"
	end if

	return my errorJson("unknown-command", "Unknown command: " & commandName)
end run

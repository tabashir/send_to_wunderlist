function STWSettings(){}
STWSettings.prototype = gENFSettings;

var gSTWSettings = new STWSettings();
gSTWSettings.init = function() {
	this.prefix = "STW";
	this.elementIDs = [
/*
			"Email",
*/
			"IdList",
/*
			"SendInterval",
			"SaveInSent",
			"MarkAsForward",
			"NoteTitle",
			"RmReFwd",
			"RmMLTag",
			"AttFwdMode",
			"AttExtFilter",
			"AttSizeFilter",
			"SkeyEnable",
*/
			"Skey"
/*
			"SkeyAlt",
			"SkeyCtrl",
			"SkeyMeta"
*/
	];

	window.addEventListener("dialogaccept",function(){gSTWSettings.savePrefs();});
	window.addEventListener("dialogcancel",function(){gSTWSettings.cancelPrefs();});
}

//Memo is not available
gSTWSettings.saveMemoText = function() {}
gSTWSettings.loadMemoText = function() {}
gSTWSettings.onChangeAccountType = function() {}

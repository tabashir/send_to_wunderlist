Components.utils.import("resource:///modules/iteratorUtils.jsm"); // import toXPCOMArray
Components.utils.import("resource:///modules/gloda/mimemsg.js"); // import MsgHdrToMimeMessage
Components.utils.import("resource:///modules/iteratorUtils.jsm"); // for fixIterator

var gsend_to_wunderlist = {
	email: null,
	msgCompFields: null,
	msgSend: null,
	mimeConverter: null,
	dirService: null,
	tagService: null,
	accountManager: null,
	hdrParser: null,
	mailSession: null,
	smtpService: null,
	noteInfo: null,
	id: null,
	isGmailIMAP: false,
	account: null,
	accountName: "",
	totalMsgs: 0,
	sentMsgs: 0,
	locked: false,
	filterAttachWS: {},
	wrapLength: 0,
	requests: [],
	
	init: function() {
		this.mimeConverter = Components.classes["@mozilla.org/messenger/mimeconverter;1"]
					.getService(Components.interfaces.nsIMimeConverter);
		this.dirService =  Components.classes["@mozilla.org/file/directory_service;1"]
					.getService(Components.interfaces.nsIProperties);
		this.tagService = Components.classes["@mozilla.org/messenger/tagservice;1"]
	 				.getService(Components.interfaces.nsIMsgTagService);
	  this.accountManager = Components.classes["@mozilla.org/messenger/account-manager;1"]
					.getService(Components.interfaces.nsIMsgAccountManager);
		this.hdrParser = Components.classes["@mozilla.org/messenger/headerparser;1"]
					.getService(Components.interfaces.nsIMsgHeaderParser);
		this.mailSession = Components.classes["@mozilla.org/messenger/services/session;1"]
	      	.getService(Components.interfaces.nsIMsgMailSession);
		this.smtpService = Components.classes["@mozilla.org/messengercompose/smtp;1"]
					.getService(Components.interfaces.nsISmtpService);

		this.setShortcutKey(); //for Normal Forward
//		this.setShortcutKey(true); //for Forward with reminder
		this.changePopupMenuState();
		var that = this;
	},

	setShortcutKey: function(altKey) {
		var prefix = altKey ? "rem_" : "";
		var app = "wunderlist.";
		var keyElem = null;
		if (altKey) {
			keyElem = document.getElementById("ENF:key_FwdMsgsRem");
		} else {
			keyElem = document.getElementById("ENF:key_FwdMsgs");
		}

		var keyPrefix = "extensions.send_to_wunderlist." + prefix;

		if (!nsPreferences.getBoolPref(keyPrefix + "enable_skey", false)) {
			keyElem.setAttribute("disabled", true);
			return;
		}

		var skey = nsPreferences.copyUnicharPref(keyPrefix + "skey", "");
		if (!skey) {
			keyElem.setAttribute("disabled", true);
			return;
		}

		var modifiers = [];
		if (nsPreferences.getBoolPref(keyPrefix + "skey_ctrl", false)) {
			modifiers.push("control");
		}

		if (nsPreferences.getBoolPref(keyPrefix + "skey_alt", false)) {
			modifiers.push("alt");
		}

		if (nsPreferences.getBoolPref(keyPrefix + "skey_meta", false)) {
			modifiers.push("meta");
		}

		var keyAttr = skey.substring(0,3) == "VK_" ? "keycode" : "key";
		var modStr = modifiers.join(" ");
		keyElem.setAttribute(keyAttr, skey);
		if (modStr) keyElem.setAttribute("modifiers", modStr);
	},
	
	finalize: function(){
		var tmpDir = this.dirService.get("TmpD", Components.interfaces.nsIFile);
		tmpDir.append("send_to_wunderlist");
		try {
			tmpDir.remove(true);
		}catch(e){}
	},
	
	emptyQueue: function() {
		this.noteInfo = [];
		this.requests = [];
	},
	
	forwardSelectedMsgsWunderList: function(event, skey) {
		this.forwardSelectedMsgs(event, false, skey, false);
	},
	
	forwardSelectedMsgsWunderListAndArchive: function(event, skey) {
		this.forwardSelectedMsgs(event, false, skey, true);
	},
	
	
	forwardSelectedMsgs: function(event, reminder, skey, archiveIt) {
		var wunderlist = true;

		var pressShift = false;
		if (event) {
			event.stopPropagation();
			if (!skey) pressShift = event.shiftKey;
		}
		
		if (gFolderDisplay.selectedMessages.length == 0) {
			document.getElementById("statusText").setAttribute("label", "No messages are selected. Canceled.");
			return;
		}
		
		var remInfo = {date: "", enable: false};
		var that = this;
		this.createNoteInfo(gFolderDisplay.selectedMessages, pressShift, remInfo, function(req){
			that.registerRequest(req);
			that.doNextRequest();
		});
		

	},
	
	fillAccountInfo: function(server, req) {
		var idPref = nsPreferences.copyUnicharPref("extensions.send_to_wunderlist.forward_id", "/")
		req.accountName = server.prettyName ? server.prettyName : "";
		if (idPref != "auto") {
			var accAndId = idPref.split("/");
			req.account = this.accountManager.getAccount(accAndId[0]);
			req.id = this.accountManager.getIdentity(accAndId[1]);
		} else if (server && (server.type == "imap" || server.type == "pop3")) { //auto
			req.id = getIdentityForServer(server);
			req.account = this.accountManager.FindAccountForServer(server);
		} else { //use default identity
			req.id = this.accountManager.defaultAccount.defaultIdentity;
			req.account = this.accountManager.defaultAccount;
		}
		
		if (!req.id) {
			document.getElementById("statusText").setAttribute("label", "Could not find outgoing server setting.");
			return false;
		}
		
		req.isGmailIMAP = server && server.type == "imap" && this.isGmailSMTPServer(req.id);
		
		return true;
	},
	
	registerRequest: function(req) {
		this.requests.push(req);
	},
	
	doNextRequest: function() {
		if (this.locked) return;
		
		var req = this.requests.shift();
		if (!req) return;
		
		this.email = nsPreferences.copyUnicharPref("extensions.send_to_wunderlist.email", "me@wunderlist.com");

		this.isGmailIMAP = req.isGmailIMAP;
		this.totalMsgs = req.totalMsgs;
		this.sentMsgs = 0;
		this.noteInfo = req.noteInfo;
		this.wrapLength = nsPreferences.getIntPref("mailnews.wraplength", 72);
		document.getElementById("statusText").setAttribute("label", "");
		this.forwardNextMsg();
	},
	
	forwardNextMsg: function() {
		var info = this.noteInfo.shift();
		if (info) {
			if (info.canceled) {
				this.forwardNextMsg();
			} else {
				try{
					var req = {};
					//var server = gFolderDisplay.displayedFolder.rootFolder.server;
					var server = info.msgHdr.folder.rootFolder.server;
					if (this.fillAccountInfo(server, req)) { 
						this.account = req.account;
						this.id = req.id;
						this.forwardMsg(info);
					} else {
						dump("Goto next\n")
						this.forwardNextMsg();
					}
				}catch(e){
					dump("[STW]Error in forwarding:\n")
					dump(e+"\n");
					dump("Goto next\n")
					this.forwardNextMsg();
				}
			}
		} else {
			this.doNextRequest();
		}
	},


	getNoteInfoForMessage: function(msgHdr, append, reminder, callback) {
		var defaultTags = "";
		var tags = [];
		var titlePref = nsPreferences.copyUnicharPref("extensions.send_to_wunderlist.title", "%S");
		var defaultTagsPref = "";
		if (defaultTagsPref) {

			defaultTags = this.expandMetaCharacters(defaultTagsPref, msgHdr, true);
			tags = tags.concat(defaultTags.split(/\s*,\s*/));
		}
		var title = this.expandMetaCharacters(titlePref, msgHdr, true);

		MsgHdrToMimeMessage(msgHdr, null, function (aMsgHdr, aMimeMessage) {
			var bodyText = aMimeMessage.coerceBodyToPlaintext(aMsgHdr.folder);

			var info = {
				msgHdr: msgHdr,
				title: title,
				tags: tags,
				append: append,
				reminder: reminder,
				delAttachments: [],
				selection: "",
				wunderlist: true,
				canceled: false,
				body: bodyText
			};
			return callback(info)
		}, true);
	},

	collectNoteInfoForMessages : function (selectedMsgs, append, reminder, callback) {
		var len = selectedMsgs.length;
		var noteInfo = [];
		var returnNow = false;
		for (var i = 0; i < len; i++) {

			returnNow = ( i == len - 1 );
			this.getNoteInfoForMessage(selectedMsgs[i], append, reminder, function (info) {
				noteInfo.push(info);
				if (returnNow) return callback(noteInfo);
			});
		}
	},

	createNoteInfo : function (selectedMsgs, append, reminder, callback) {

		this.collectNoteInfoForMessages(selectedMsgs, append, reminder, function (noteInfo) {
			var req = {
				account: null,
				id: null,
				noteInfo: noteInfo,
				isGmailIMAP: false,
				wunderlist: false,
				totalMsgs: noteInfo.length
			};
			return callback(req);
		})
	},
	
	isGmailSMTPServer: function(id) {
		var smtpServerKey = id.smtpServerKey ? id.smtpServerKey : this.smtpService.defaultServer.key;
		var hostname = nsPreferences.copyUnicharPref("mail.smtpserver."+smtpServerKey+".hostname", "");
		return hostname == "smtp.gmail.com" || hostname == "smtp.googlemail.com";
	},
	
	forwardMsg: function(info) {
		var msgHdr = info.msgHdr;
		
		this.msgCompFields = Components.classes["@mozilla.org/messengercompose/composefields;1"].createInstance(Components.interfaces.nsIMsgCompFields);
		this.msgCompFields.from = this.id.email;
		this.msgCompFields.to = this.email;
		
		var saveSentPref = info.wunderlist ? "extensions.send_to_wunderlist.save_sent" : "extensions.send_to_wunderlist.save_sent";
		if (!nsPreferences.getBoolPref(saveSentPref, true) || this.isGmailIMAP) {
			this.msgCompFields.fcc = "nocopy://";
			this.msgCompFields.fcc2 = "nocopy://";
		}

		var tagsStr = info.tags && info.tags.length > 0 ? this.getTagsString(info.tags) : "";
		var remStr = info.reminder ? "!" + info.reminderDate : ""
		
		var subject = info.title;
		if (info.append) {
			subject = subject + " " + "+";
		} else {
			subject = subject + " " + remStr + " " + tagsStr;
		}

		//this.msgCompFields.subject = this.encode(subject, 9, 72, msgHdr.Charset);
		//force UTF-8 encoding since added characters becomes ??? if msgHdr.Charset does not support it.
		this.msgCompFields.subject = this.encode(subject, 9, 72, null);
		try {
			this.sendMsgFile(info);
		}catch(e){
			dump(e);
		}
		return true;
	},
	
	getTagsForMsg: function(msgHdr) {
		var curKeys = msgHdr.getStringProperty("keywords");
		var ignoredTags = nsPreferences.copyUnicharPref("extensions.send_to_wunderlist.ignored_tags", "").split(" ");
		if (msgHdr.label) {
		  curKeys += " $label" + msgHdr.label;
		}
		var keys = curKeys ? curKeys.split(" ") : [];
		var tags = [];
		var len = keys.length;
		for (var i=0; i<len; i++) {
			var key = keys[i];
			var tagName = "";
			try {
				tagName = this.tagService.getTagForKey(key);
			} catch(e) {
				tagName = null;
				dump("Unknown tag key: " + key + "\n");
			}
			if (tagName && ignoredTags.indexOf(key) < 0) {
				tags.push(tagName);
			}
		}
		
		return tags;
	},
	
	encode: function(str, offset, len, charset) {
		if (!charset) charset = "UTF-8";
		var estr = this.mimeConverter.encodeMimePartIIStr_UTF8(str, false, charset, offset, len);
		return estr;
	},
	
	decode: function(str) {
		return this.mimeConverter.decodeMimeHeader(str, null, false, true);
	},
	
	getTagsString: function(tags) {
		var len = tags.length;
		var str = "";
		for (var i=0; i<len; i++) {
			if (tags[i]) str = str + " #" + tags[i];
		}
		
		return str;
	},

	createHeaderString: function() {
		var id = (new Date()).valueOf();
		var messageId = id + "." + this.msgCompFields.from
		var str = "Message-ID: " + messageId + "\r\n"
							+ "Date: " + (new Date()).toString() + "\r\n"
							+ "From: " + this.msgCompFields.from + "\r\n"
							+ "MIME-Version: 1.0\r\n"
							+ "To: " + this.msgCompFields.to + "\r\n"
							+ "Subject: " + this.msgCompFields.subject + "\r\n"
							+ this.plainMessageBodyHeader();
		return str;
	},

	plainMessageBodyHeader: function() {
		var str = 'Content-Type: text/plain; charset=utf-8; format=flowed\r\n'
							+ 'Content-Transfer-Encoding: 7bit\r\n'
							+ "\r\n";
		return str;
	},

	htmlMessageBodyHeader: function(id) {
		var boundary = "--------------ENF" + id;
		var str = 'Content-Type: text/plain; charset=utf-8; format=flowed\r\n'
			+ "Content-Type: multipart/mixed;\r\n"
			+ ' boundary="' + boundary + '"' + "\r\n"
			+ "\r\n"
			+ "This is a multi-part message in MIME format.\r\n";
		return str;
	},
	
	composeAsInline: function(info) {
		var msgHdr = info.msgHdr;
		var uri = msgHdr.folder.getUriForMsg(msgHdr);
		var msgFile = this.createTempFile();

		var messageService = messenger.messageServiceFromURI(uri);
		var messageStream = Components.classes["@mozilla.org/network/sync-stream-listener;1"].
		  createInstance().QueryInterface(Components.interfaces.nsIInputStream);
		var inputStream = Components.classes["@mozilla.org/scriptableinputstream;1"].
		  createInstance().QueryInterface(Components.interfaces.nsIScriptableInputStream);
		inputStream.init(messageStream);
		messageService.streamMessage(uri, messageStream, msgWindow, null, false, null);
		var os = Components.classes['@mozilla.org/network/file-output-stream;1'].
									createInstance(Components.interfaces.nsIFileOutputStream);
		os.init(msgFile, 2, 0x200, false); // open as "write only"
		
		var messageText = this.createHeaderString();
		messageText += info.body;
		os.write(messageText, messageText.length);
		this.dumpTrace(messageText);

		messageStream.close();
		inputStream.close();
		os.close();
		
		return msgFile;
	},
	

	sendMsgFile: function(info) {
		var msgHdr = info.msgHdr;
		var msgFile = null;
		var appName = "wunderlist";
		dump("[STW] Forward by Inline mode\n");
		msgFile = this.composeAsInline(info);
		
		var previewMode = nsPreferences.getBoolPref("extensions.send_to_wunderlist.preview_mode", false);
		this.msgSend = Components.classes["@mozilla.org/messengercompose/send;1"].createInstance(Components.interfaces.nsIMsgSend);
		var that = this;
		//nsIMsgSendListener
		var sendListener = {
			QueryInterface: function(iid) {
    		if (iid.equals(Components.interfaces.nsIMsgSendListener) ||
        		iid.equals(Components.interfaces.nsISupportsWeakReference) ||
        		iid.equals(Components.interfaces.nsISupports)) return this;
    		else throw Components.results.NS_NOINTERFACE;
  		},
			onStartSending: function(aMsgID, aMsgSize) {
				that.sentMsgs += 1;
				document.getElementById("statusText").setAttribute("label", "Sending note to "+ appName + " ... " + "["+that.sentMsgs+"/"+that.totalMsgs+"]");
			},
			
			onProgress: function(aMsgID, aProgress, aProgressMax) {
			},
			
			onStatus: function(aMsgID, aMsg) {
			},
			
			onStopSending: function(aMsgID, aStatus, aMsg, returnFileSpec) {
				if (this.statusInterval) clearInterval(this.statusInterval);
				if (aStatus) { //error
					document.getElementById("statusText").setAttribute("label", "Failed to send note.");
				} else {
					document.getElementById("statusText").setAttribute("label", "Forwarding to "+ appName + " ... done.");
					var markFwdPref = info.wunderlist ? "extensions.send_to_wunderlist.mark_as_forwarded" : "extensions.send_to_wunderlist.mark_as_forwarded"
					if (nsPreferences.getBoolPref(markFwdPref, true)) {
						msgHdr.flags = msgHdr.flags | Components.interfaces.nsMsgMessageFlags.Forwarded;
					}
				}
				
				//do next
				if (that.sentMsgs == that.totalMsgs) {
					that.locked = false;
					that.changePopupMenuState();
				}
				that.forwardNextMsg();
			},
			
			onGetDraftFolderURI: function(aFolderURI) {
			},
			
			onSendNotPerformed: function(aMsgID, aStatus) {
			}
		};
		
		//nsIMsgStatusFeedback and nsIWebProgressListener
		var feedback = {
			QueryInterface: function(iid) {
				if (iid.equals(Components.interfaces.nsIMsgStatusFeedback) ||
					iid.equals(Components.interfaces.nsIWebProgressListener) ||
					iid.equals(Components.interfaces.nsISupportsWeakReference) ||
					iid.equals(Components.interfaces.nsISupports)) return this;
				else throw Components.results.NS_NOINTERFACE;
			},

			//nsIMsgStatusFeedback
			showStatusString: function(statusText) {
				document.getElementById("statusText").setAttribute("label", statusText + "["+that.sentMsgs+"/"+that.totalMsgs+"]");
			},

			startMeteors: function() {
			},

			stopMeteors: function() {
			},

			showProgress: function(percentage) {
			},

			setStatusString: function (aStatus) {
			},

			setWrappedStatusFeedback: function(aStatusFeedback) {
			},

			//nsIWebProgressListener
			onStateChange: function(aWebProgress, aRequest, aStateFlags, aStatus) {
			},
			
			onProgressChange: function(aWebProgress, aRequest, aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress, aMaxTotalProgress) {
			},
			
			onLocationChange: function(aWebProgress, aRequest, aLocation) {
			},
			
			onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage) {
			},
			
			onSecurityChange: function(aWebProgress, aRequest, state) {
			}
		};

 		var deliverMode = previewMode 
 										? this.msgSend.nsMsgQueueForLater
 										: this.msgSend.nsMsgDeliverNow;
 										
		this.locked = true;
		this.changePopupMenuState();
		
		this.msgSend.sendMessageFile(
			 this.id,                		// in nsIMsgIdentity       aUserIdentity,
			 this.account.key,          // char* accountKey,
			 this.msgCompFields,        // in nsIMsgCompFields     fields,
				 msgFile,                 // in nsIFile          sendIFile,
			 false,                     // in PRBool               deleteSendFileOnCompletion,
			 false,                     // in PRBool               digest_p,
			 deliverMode,       				// in nsMsgDeliverMode     mode,
			 null,               				// in nsIMsgDBHdr          msgToReplace,
			 sendListener,     					// in nsIMsgSendListener   aListener,
			 feedback,   								// in nsIMsgStatusFeedback aStatusFeedback,
			 ""                         // in string               password
		);
		
		if (previewMode) {
			sendListener.onStartSending(null, 0);
			sendListener.onStopSending(null, 0, null, null);
		}
	},

	getThunderLink: function(message) {
		return "thunderlink://" + "messageid=" + message.messageId;
	},

	createAddressesString: function(addrsStr, fullName, wrap) {

		var addrs = [];
		var addresses = {};
		var names = {};
		var fullNames = {};
		var count = {};
		var wrapLen = wrap ? this.wrapLength : 0;
		var cols = 0;
		this.hdrParser.parseHeadersWithArray(addrsStr, addresses, names, fullNames, count);
		for (var i=0; i<addresses.value.length; i++) {
			var addrVal = addresses.value[i];
			if (addrVal) {
				var name = "";
				if (fullName) {
					name = fullNames.value[i];
				} else {
					name = names.value[i] ? names.value[i] : addrVal.split("@")[0];
				}
				
				var htmlBR = "";
				if (wrapLen > 0 && cols + name.length > wrapLen) { //wrap
					htmlBR = "<BR>";
					cols = name.length;
				} else {
					cols = cols + name.length + 2; //2 means , and space
				}
					addrs.push(htmlBR + name);
			}
		}
		return addrs.join(", ");
	},

	escapeHTMLMetaCharacter : function(str) {
		return str.replace(/["&'<>]/gm, function(c) {
			return {
				'"' : '&quot;',
				'&' : '&amp;',
				'\'' : '&#39;',
				'<' : '&lt;',
				'>' : '&gt;'
			}[c];
		});
	},
	
	expandMetaCharacters: function(str, msgHdr, isTitle) {
		var sub = msgHdr.mime2DecodedSubject;
		if (isTitle) {
			if (nsPreferences.getBoolPref("extensions.send_to_wunderlist.rm_mltag",false)) {
				sub = sub.replace(/^(?:\[[^\]]+\]|\([^\)]+\))+/i, "");
			}
			if (nsPreferences.getBoolPref("extensions.send_to_wunderlist.rm_re_fwd",false)) {  
				sub = sub.replace(/^(?:\s*re:\s*|\s*fwd:\s*|\s*fw:\s*)+/i, "");
			} else if (msgHdr.flags & Components.interfaces.nsMsgMessageFlags.HasRe) {
				sub = "Re: " + sub;
			}
		}

		var author = this.createAddressesString(msgHdr.mime2DecodedAuthor, true, false);
		var authorName = this.createAddressesString(msgHdr.mime2DecodedAuthor, false, false);
		var toList = this.createAddressesString(this.decode(msgHdr.recipients), true, !isTitle);
		var ccList = this.createAddressesString(this.decode(msgHdr.ccList), true, !isTitle);
		var toNames = this.createAddressesString(this.decode(msgHdr.recipients), false, !isTitle);
		var ccNames = this.createAddressesString(this.decode(msgHdr.ccList), false, !isTitle);
		
		var folderName = msgHdr.folder.prettiestName;
		
		var date = new Date();
		date.setTime(msgHdr.dateInSeconds*1000);
		var y = date.getYear() + 1900;
		var mon = date.getMonth() + 1;
		if (mon < 10) mon = "0" + mon;
		var d = date.getDate();
		if (d < 10) d = "0" + d;
		var h = date.getHours();
		if (h < 10) h = "0" + h;
		var m = date.getMinutes();
		if (m < 10) m = "0" + m;
		var s = date.getSeconds();
		if (s < 10) s = "0" + s;
		
		var accountName = this.accountName;
		
		str = str.replace(/\%S/gm, sub);
		str = str.replace(/\%F/gm, folderName);
		str = str.replace(/\%N/gm, accountName);
		
		str = str.replace(/\%A/gm, author);
		str = str.replace(/\%T/gm, toList);
		str = str.replace(/\%C/gm, ccList);

		str = str.replace(/\%a/gm, authorName);
		str = str.replace(/\%t/gm, toNames);
		str = str.replace(/\%c/gm, ccNames);

		str = str.replace(/\%Y/gm, y);
		str = str.replace(/\%M/gm, mon);
		str = str.replace(/\%D/gm, d);

		str = str.replace(/\%h/gm, h);
		str = str.replace(/\%m/gm, m);
		str = str.replace(/\%s/gm, s);
		
		str = str.replace(/\%L/gm, this.getThunderLink(msgHdr));

		return str;
	},

	createAddressNamesStr: function(listStr) {
		if (!listStr) return "";
		var addresses = {};
		var names = {};
		var fullNames = {};
		var count = {};
		this.hdrParser.parseHeadersWithArray(listStr, addresses, names, fullNames, count);

		var len = addresses.value.length;
		var nameList = [];
		for (var i=0; i<len; i++) {
			if (names.value[i]) {
				nameList.push(names.value[i]);
			} else {
				nameList.push(addresses.value[i].split("@")[0]);
			}
		}

		return nameList.join(", ");
	},

	createTempFile: function() {
		var tmpDir = this.dirService.get("TmpD", Components.interfaces.nsIFile);
		tmpDir.append("send_to_wunderlist");
		tmpDir.append("send_to_wunderlist.tmp");
		tmpDir.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0666);
		return tmpDir;
	},

	abortForward: function() {
		this.totalMsgs = 0;
		this.sentMsgs = 0;
		this.noteInfo = [];

		var locked = this.locked;
		this.locked = false;
		this.changePopupMenuState();
		try {
			if (locked) this.msgSend.abort();
		} catch(e) {
			dump(e);
		}

		document.getElementById("statusText").setAttribute("label", "Forwarding was aborted.");
	},

	changePopupMenuState: function() {
		if (this.locked) {
			document.getElementById("ENFwd:FwdMenu").setAttribute("collapsed", true);
			document.getElementById("ENFwd:CancelMenu").removeAttribute("collapsed");
		} else {
			document.getElementById("ENFwd:FwdMenu").removeAttribute("collapsed");
			document.getElementById("ENFwd:CancelMenu").setAttribute("collapsed", true);
		}
	},

	base64ToUtf8: function(str) {
		return decodeURIComponent(escape(window.atob(str)));
	},

	dumpTrace: function () {
		var err = new Error();
		dump('***************************** Trace Begin ***************************************')
		dump("\nStack trace:\n" + err.stack + "\n\n");
		dump('***************************** Trace End *****************************************')
	}

};

window.addEventListener("load", function(){gsend_to_wunderlist.init()}, false);
window.addEventListener("close", function(){gsend_to_wunderlist.finalize()}, false);

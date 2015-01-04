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
		this.setShortcutKey(true); //for Forward with reminder
		this.setShortcutKey(false, true); //for wunderlist
		this.changePopupMenuState();
		
		var that = this;
	},
	
	setShortcutKey: function(rem, wunderlist) {
		var prefix = rem ? "rem_" : "";
		var app = "wunderlist.";
		var keyElem = null;
		if (rem) {
			keyElem = wunderlist ? document.getElementById("ENF:key_FwdMsgsRemWunderList") : document.getElementById("ENF:key_FwdMsgsRem");
		} else {
			keyElem = wunderlist ? document.getElementById("ENF:key_FwdMsgsWunderList") : document.getElementById("ENF:key_FwdMsgs");
		}

		if (!nsPreferences.getBoolPref("extensions.send_to_wunderlist." + app + prefix + "enable_skey", false)) {
			keyElem.setAttribute("disabled", true);
			return;
		}

		var skey = nsPreferences.copyUnicharPref("extensions.send_to_wunderlist." + app + prefix + "skey", "");
		if (!skey) {
			keyElem.setAttribute("disabled", true);
			return;
		}

		var modifiers = [];
		if (nsPreferences.getBoolPref("extensions.send_to_wunderlist." + app + prefix + "skey_ctrl", false)) {
			modifiers.push("control");
		}

		if (nsPreferences.getBoolPref("extensions.send_to_wunderlist." + app + prefix + "skey_alt", false)) {
			modifiers.push("alt");
		}

		if (nsPreferences.getBoolPref("extensions.send_to_wunderlist." + app + prefix + "skey_meta", false)) {
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

		var req = {
			account: null,
			id: null,
			noteInfo: null,
			isGmailIMAP: false,
			wunderlist: wunderlist,
			totalMsgs: 0
		};

		req.noteInfo = this.createNoteInfo(gFolderDisplay.selectedMessages, pressShift, remInfo, wunderlist);
		
		req.totalMsgs = req.noteInfo.length;

		this.registerRequest(req);
		this.doNextRequest();
	},
	
	fillAccountInfo: function(server, req) {
		var idPref = nsPreferences.copyUnicharPref("extensions.send_to_wunderlist.wunderlist.forward_id", "/")
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
		
		if (req.wunderlist) {
			this.email = nsPreferences.copyUnicharPref("extensions.send_to_wunderlist.wunderlist.email", "me@wunderlist.com");
//		} else if (!this.confirmENEmail()) {
//			this.emptyQueue();
//			return;
		}
		
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
					dump("[ENF]Error in forwarding:\n")
					dump(e+"\n");
					dump("Goto next\n")
					this.forwardNextMsg();
				}
			}
		} else {
			this.doNextRequest();
		}
	},
	
	createNoteInfo: function(selectedMsgs, append, reminder) {
		var noteInfo = [];
		var wunderlist = true;
		var titlePref = nsPreferences.copyUnicharPref("extensions.send_to_wunderlist.wunderlist.title", "%S");
		var defaultTagsPref = "";

		var len = selectedMsgs.length;

		for (var i=0; i<len; i++) {
			var msgHdr = selectedMsgs[i];
			var defaultTags = "";
//			var tags = nsPreferences.getBoolPref("extensions.send_to_wunderlist.add_msg_tags", false) ? this.getTagsForMsg(msgHdr) : [];
			var tags = [];
			if (defaultTagsPref) {

				defaultTags = this.expandMetaCharacters(defaultTagsPref, msgHdr, true, wunderlist);
				tags = tags.concat(defaultTags.split(/\s*,\s*/));
			}
			
			var title = this.expandMetaCharacters(titlePref, msgHdr, true, wunderlist);
			var info = {
				msgHdr: msgHdr,
				title: title,
				tags: tags,
				append: append,
				reminder: reminder.enable,
				reminderDate: reminder.date,
				delAttachments: [],
				fwdAttachments: [],
				selection: "",
				wunderlist: wunderlist,
				canceled: false
			};
			
			noteInfo.push(info);
		}
		
		return noteInfo;
	},
	
	isGmailSMTPServer: function(id) {
		var smtpServerKey = id.smtpServerKey ? id.smtpServerKey : this.smtpService.defaultServer.key;
		var hostname = nsPreferences.copyUnicharPref("mail.smtpserver."+smtpServerKey+".hostname", "");
		return hostname == "smtp.gmail.com" || hostname == "smtp.googlemail.com";
	},
	
	forwardMsg: function(info) {
		var msgHdr = info.msgHdr;
		
		this.msgCompFields = Components.classes["@mozilla.org/messengercompose/composefields;1"]
			.createInstance(Components.interfaces.nsIMsgCompFields);
		this.msgCompFields.from = this.id.email;
		this.msgCompFields.to = this.email;
		
		var saveSentPref = info.wunderlist ? "extensions.send_to_wunderlist.wunderlist.save_sent" : "extensions.send_to_wunderlist.save_sent";
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
			//this.sendMsgFile(info);
			this.stripAttachmentsAndFwd(info);
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
				dump("Unknow tag key: " + key + "\n");
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
		var boundary = "--------------ENF" + id;
		var str = "Message-ID: " + messageId + "\r\n"
							+ "Date: " + (new Date()).toString() + "\r\n"
							+ "From: " + this.msgCompFields.from + "\r\n"
							+ "MIME-Version: 1.0\r\n"
							+ "To: " + this.msgCompFields.to + "\r\n"
							+ "Subject: " + this.msgCompFields.subject + "\r\n"
							+ "Content-Type: multipart/mixed;\r\n"
							+ ' boundary="' + boundary + '"' + "\r\n"
							+ "\r\n"
							+ "This is a multi-part message in MIME format.\r\n"
		return [str, boundary];
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
		
		var data = "";
		var eohInfo = null;
		
		//setup attachments filter
		//check delAttachments is empty or not
		var filter = false;
		var key = "";
		for (key in info.delAttachments) {
			filter = true;
			break;
		}
		this.initFilterAttachWS();
		
		while (inputStream.available()) {
			data += inputStream.read(512);
			if (!eohInfo) {
				eohInfo = this.findEndOfHeader(data);
				if (!eohInfo) continue; //loop while end of header(\r\n\r\n) is found
				
				var hdr = data.substring(0, eohInfo.index - (eohInfo.retcode.length * 2)).split(eohInfo.retcode);
				if (data.length > eohInfo.index) data = data.substring(eohInfo.index, data.length);
				else data = "";

				var line = "";
				var ignored = false;
				var writeFrom = false;
				var writeTo = false;
				while (line = hdr.shift()) {
					if ((ignored && /^\s+/.test(line))) continue;
					if (ignored = this.isIgnoredHdr(line)) continue;
					if (/^from:/i.test(line)) {
						line = "From: "+this.msgCompFields.from;
						writeFrom = true;
						ignored = true;
					} else if (/^to:/i.test(line)) {
						line = "To: "+this.msgCompFields.to;
						writeTo = true;
						ignored = true;
					} else if (/^subject:/i.test(line)) {
						line = "Subject: " + this.msgCompFields.subject;
						ignored = true;
					}

					//write line
					line = hdr.length > 0 ? line + "\r\n" : line;
					//os.write(line, line.length);
					this.filterAndWrite(os, line, info, filter);
				}
				if (!writeFrom) {
					line = "\r\n" + "From: "+this.msgCompFields.from;
					//os.write(line, line.length);
					this.filterAndWrite(os, line, info, filter);
				}
				if (!writeTo) {
					line = "\r\n" + "To: "+this.msgCompFields.to;
					//os.write(line, line.length);
					this.filterAndWrite(os, line, info, filter);
				}

				line = "\r\n\r\n";
				//os.write(line, line.length);
				//os.write(data, data.length);
				this.filterAndWrite(os, line+data, info, filter);
				data = "";
			} else { //now in the message body
				//write data
				//var lines = data.split(eohInfo.retcode);
				//data = lines.pop();
				//var writeData = lines.join("\r\n");
				//os.write(writeData, writeData.length);
				//var writeData = filter ? this.filterAttachments(data, info) : data;
				//if (writeData) os.write(writeData, writeData.length);
				this.filterAndWrite(os, data, info, filter);
				//os.write(data, data.length);
				data = "";
			}
		}

		//flush attachments filter
		if (filter) {
			this.filterAndWrite(os, "", info, filter);
			//var writeData = this.filterAttachments("", info);
			//if (writeData) os.write(writeData, writeData.length);
		}
		
		messageStream.close();
		inputStream.close();
		os.close();
		
		return msgFile;
	},
	
	filterAndWrite: function(os, data, info, filter) {
		//var writeData = filter ? this.filterAttachments(data, info) : data;
		var writeData = this.filterAttachments(data, info, filter);
		if (writeData) os.write(writeData, writeData.length);	
	},
	
	isIgnoredHdr: function(line) {
		var ignored = /^>*from \S+ /i.test(line) ||
			/^bcc: /i.test(line) ||
			/^fcc: /i.test(line) ||
			/^content-length: /i.test(line) ||
			/^lines: /i.test(line) ||
			/^status: /i.test(line) ||
			/^x-.+: /i.test(line) ||
			/^return-path: /i.test(line) ||
			/^delivered-to: /i.test(line) ||
			/^authentication-results: /i.test(line) ||
			/^message-id: /i.test(line) ||
			/^(?:in-)*reply-to: /i.test(line) ||
			/^bounce-to: /i.test(line) ||
			/^DKIM-Signature: /i.test(line) ||
			/^DomainKey-Signature: /i.test(line) ||
			/^received(?:-.+)*: /i.test(line);
		
		return ignored;
	},
	
	findEndOfHeader: function(data) {
		var candidates = ["\r\n", "\n\r", "\n", "\r"];
		var headerEnd = -1;
		var ret = null;
		for (var i=0; i<candidates.length; i++) {
			var candidate = candidates[i];
			headerEnd = data.indexOf(candidate + candidate);
			if (headerEnd != -1) {
				ret = {index: headerEnd + (candidate.length * 2), retcode: candidate};
				break;
			}
		}
		
		return ret;
	},
	
	sendMsgFile: function(info) {
		var msgHdr = info.msgHdr;
		var msgFile = null;
		var appName = "wunderlist";
		dump("[ENF] Forward by Inline mode\n");
		msgFile = this.composeAsInline(info);
		
		var previewMode = nsPreferences.getBoolPref("extensions.send_to_wunderlist.preview_mode", false);
		this.msgSend = Components.classes["@mozilla.org/messengercompose/send;1"]
									.createInstance(Components.interfaces.nsIMsgSend);
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
					var markFwdPref = info.wunderlist ? "extensions.send_to_wunderlist.wunderlist.mark_as_forwarded" : "extensions.send_to_wunderlist.mark_as_forwarded"
					if (nsPreferences.getBoolPref(markFwdPref, true)) {
						msgHdr.flags = msgHdr.flags | Components.interfaces.nsMsgMessageFlags.Forwarded;
					}
				}
				
				//do next
				var sendIntPref = info.wunderlist ? "extensions.send_to_wunderlist.wunderlist.send_interval" : "extensions.send_to_wunderlist.send_interval"
				var waitSec = nsPreferences.getIntPref(sendIntPref, 1);
				if (that.sentMsgs != that.totalMsgs) {
					if (waitSec > 0) {
						document.getElementById("statusText").setAttribute("label", "Waiting " + waitSec + " seconds ...");
					} else {
						waitSec = 1;
					}
					setTimeout(
						function() {that.forwardNextMsg();},
						 waitSec * 1000
					);
				} else {
					setTimeout(
						function() {that.locked = false; that.changePopupMenuState(); that.forwardNextMsg();},
						 waitSec * 1000
					);
				}
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
			 this.id,                // in nsIMsgIdentity       aUserIdentity,
			 this.account.key,          // char* accountKey,
			 //id.key,          // char* accountKey,
			 this.msgCompFields,                   // in nsIMsgCompFields     fields,
			 msgFile,                        // in nsIFile          sendIFile,
			 false,                            // in PRBool               deleteSendFileOnCompletion,
			 false,                           // in PRBool               digest_p,
//				 this.msgSend.nsMsgDeliverNow,         // in nsMsgDeliverMode     mode,
			 deliverMode,         // in nsMsgDeliverMode     mode,
			 null,                            // in nsIMsgDBHdr          msgToReplace,
			 sendListener,     // in nsIMsgSendListener   aListener,
			 feedback,   // in nsIMsgStatusFeedback aStatusFeedback,
			 ""                             // in string               password
		);
		
		if (previewMode) {
			sendListener.onStartSending(null, 0);
			sendListener.onStopSending(null, 0, null, null);
		}
	},
	
	initFilterAttachWS: function() {
		this.filterAttachWS.stat = "flush";
		this.filterAttachWS.boundary = "";
		this.filterAttachWS.buf = "";
		this.filterAttachWS.prev = "";
		this.filterAttachWS.inContentType = false;
		this.filterAttachWS.name = "";
		this.filterAttachWS.definedBoundaries = [];
	},
	
	filterAttachments: function(data, info, filter) {
		var lines = (this.filterAttachWS.prev + data).split("\r\n");
		var ret = "";
		var len = lines.length - 1;

		if (len < 1) {
			return lines[0]; //end of file. flush buffer.
		} else {
			this.filterAttachWS.prev = lines[len]; //last one line becomes prev
		}
		
		for (var i=0; i<len; i++) {
			var line = lines[i];
			//invalidate s/mime signature
			line = line.replace("multipart/signed", "multipart/mixed");
			
			if (!filter) { //don't filter but invalidate s/mime
				ret = ret + line + "\r\n";
				continue;
			}
			
			if (this.filterAttachWS.inContentType && (line == "" || /^\S+/.test(line))) {
				this.filterAttachWS.inContentType = false;
				if (this.filterAttachWS.name) {
					this.filterAttachWS.name = this.mimeConverter.decodeMimeHeader(this.filterAttachWS.name, null, false, true);
					if (info.delAttachments[this.filterAttachWS.name]) {
						this.filterAttachWS.stat = "skip";
						this.filterAttachWS.buf = "";
					}
					this.filterAttachWS.name = "";
				}
				
			}
			
			if (/^\-\-\S/.test(line)) { //boundary
				if (this.filterAttachWS.definedBoundaries[line]) {//filters out non-boundary such as -->, --<spc>
					if (this.filterAttachWS.stat != "skip" || line.indexOf(this.filterAttachWS.boundary) == 0) {
						this.filterAttachWS.boundary = line;
						this.filterAttachWS.stat = "boundary";
					}
				}
			} else if (this.filterAttachWS.inContentType || (!this.filterAttachWS.name && /^Content-Type: /i.test(line))) {
				var idx = line.indexOf("name=");
				this.filterAttachWS.inContentType = true;
				if (idx > 0) {
					this.filterAttachWS.name = line.substring(idx+5).replace(/\"/g, "");
					//this.filterAttachWS.stat = "skip";
					//this.filterAttachWS.buf = "";
				} else if (this.filterAttachWS.name) {
					this.filterAttachWS.name += "\r\n" + line.replace(/\"/g, "");
				}
				
				idx = line.indexOf("boundary=");
				if (idx > 0) {
					var boundary = line.substring(idx+9).replace(/\"/g, "");
					this.filterAttachWS.definedBoundaries["--"+boundary] = true; //start of section
					this.filterAttachWS.definedBoundaries["--"+boundary+"--"] = true; //end of section
				}
			} else if (this.filterAttachWS.stat == "buffer" && line == "") {
				this.filterAttachWS.stat = "flush";
			}

			switch (this.filterAttachWS.stat) {
				case "boundary":
					ret = ret + line + "\r\n";
					this.filterAttachWS.stat = "buffer";
					break;
				case "buffer":
					this.filterAttachWS.buf = this.filterAttachWS.buf + line + "\r\n";
					break;
				case "skip":
					break; //nothing is done
				case "flush":
					ret = ret + this.filterAttachWS.buf + line + "\r\n";
					this.filterAttachWS.buf = "";
					break;
				default:
			}
			
			//if (!this.filterAttachWS.inAttachBody) {
			//	ret = ret + line + "\r\n";
			//}
		}
		
		return ret;
	},
	
	text2html: function(str, escape) {
		var ret = escape ? this.escapeHTMLMetaCharacter(str) : str;
		ret = ret.split("\n").join("<br>");
		ret = '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">'
				+ '<head>'
				+ '<meta http-equiv="content-type" content="text/html;charset=UTF-8">'
				+	'</head>'
				+	'<body><div>'
				+ ret
				+ '</div></body>'
				+ '</html>'
		return ret;
	},
	
	getThunderLink: function(message) {
		return "thunderlink://" + "messageid=" + message.messageId;
	},

	createAddressesString: function(addrsStr, fullName, provideLink, wrap) {

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
				
//				if (provideLink) {
//					addrs.push(htmlBR + '<a href="' + 'mailto:' + addrVal + '">' + this.escapeHTMLMetaCharacter(name) + '</a>');
//				} else {
					addrs.push(htmlBR + name);
//				}
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
	
	expandMetaCharacters: function(str, msgHdr, isTitle, fwdAtts, delAtts, escape, wunderlist) {
		var sub = msgHdr.mime2DecodedSubject;
		var app = wunderlist ? "wunderlist.": "";
		if (isTitle) {
			if (nsPreferences.getBoolPref("extensions.send_to_wunderlist." + app + "rm_mltag",false)) {
				sub = sub.replace(/^(?:\[[^\]]+\]|\([^\)]+\))+/i, "");
			}
			if (nsPreferences.getBoolPref("extensions.send_to_wunderlist." + app + "rm_re_fwd",false)) {  
				sub = sub.replace(/^(?:\s*re:\s*|\s*fwd:\s*|\s*fw:\s*)+/i, "");
			} else if (msgHdr.flags & Components.interfaces.nsMsgMessageFlags.HasRe) {
				sub = "Re: " + sub;
			}
		}
//		var provideLink = !wunderlist && !isTitle && nsPreferences.getBoolPref("extensions.send_to_wunderlist.mailto_link", false);
		var provideLink = false;
		
		
		var author = this.createAddressesString(msgHdr.mime2DecodedAuthor, true, provideLink, false);
		//var authorName = this.hdrParser.extractHeaderAddressName(author);
		//if (authorName.indexOf("@")) authorName = authorName.split("@")[0]; //only email address. use account name to avoid conflict with notebook
		var authorName = this.createAddressesString(msgHdr.mime2DecodedAuthor, false, provideLink, false);


		//var toList = this.decode(msgHdr.recipients);
		var toList = this.createAddressesString(this.decode(msgHdr.recipients), true, provideLink, !isTitle);
		//var ccList = this.decode(msgHdr.ccList);
		var ccList = this.createAddressesString(this.decode(msgHdr.ccList), true, provideLink, !isTitle);

		//var toNames = this.createAddressNamesStr(toList);
		var toNames = this.createAddressesString(this.decode(msgHdr.recipients), false, provideLink, !isTitle);
		//var ccNames = this.createAddressNamesStr(ccList);
		var ccNames = this.createAddressesString(this.decode(msgHdr.ccList), false, provideLink, !isTitle);
		
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
		
		if (escape) {
			sub = this.escapeHTMLMetaCharacter(sub);
			folderName = this.escapeHTMLMetaCharacter(folderName);
			accountName = this.escapeHTMLMetaCharacter(accountName);
			//author = this.escapeHTMLMetaCharacter(author);
			//toList = this.escapeHTMLMetaCharacter(toList);
			//ccList = this.escapeHTMLMetaCharacter(ccList);
			//authorName = this.escapeHTMLMetaCharacter(authorName);
			//toNames = this.escapeHTMLMetaCharacter(toNames);
			//ccNames = this.escapeHTMLMetaCharacter(ccNames);
		}
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

//		if (fwdAtts) {
//			var name = "";
//			var cols = 0;
//			var atts = [];
//			for (name in fwdAtts) {
//				var att = fwdAtts[name];
//				if (att && !att.del) {
//					var htmlBR = "";
//					if (this.wrapLength > 0 && cols + name.length > this.wrapLength) { //wrap
//						htmlBR = "<BR>";
//						cols = name.length;
//					} else {
//						cols = cols + name.length + 2; //2 means , and space
//					}
//					atts.push(htmlBR + this.escapeHTMLMetaCharacter(name));
//				}
//			}
//			var attsStr = atts.join(", ");
//			str = str.replace(/\%r/gm, attsStr);
//		}

//		if (delAtts) {
		var name = "";
		var cols = 0;
		var atts = [];
		for (name in delAtts) {
			var att = delAtts[name];
			if (att && att.del) {
				var htmlBR = "";
				if (this.wrapLength > 0 && cols + name.length > this.wrapLength) { //wrap
					htmlBR = "<BR>";
					cols = name.length;
				} else {
					cols = cols + name.length + 2; //2 means , and space
				}
				atts.push(htmlBR + this.escapeHTMLMetaCharacter(name));
			}
		}
		var attsStr = atts.join(", ");
		str = str.replace(/\%R/gm, attsStr);
//		}

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

	utf8ToBase64: function(str) {
		var b64 = window.btoa(unescape(encodeURIComponent(str)));
		var ret = "";
		var start = 0;
		var len = b64.length;
		for (; start + 76 < len; start += 76) {
			ret += b64.substr(start, 76) + "\r\n";
		}

		if (start < len) ret += b64.substr(start) + "\r\n";

		return ret;
	},

	base64ToUtf8: function(str) {
		return decodeURIComponent(escape(window.atob(str)));
	},

	stripAttachmentsAndFwd: function(info) {
		var msgHdr = info.msgHdr;
		if (!(msgHdr.flags & Components.interfaces.nsMsgMessageFlags.Attachment)) {
			this.sendMsgFile(info);
		} else {
			var msgHdr = info.msgHdr;
			var that = this;
			var mimeCallback = function(msgHdr, mimeMsg) {
				var atts = mimeMsg.allAttachments;
				var delAttachments = [];
				var fwdAttachments = [];
				var app = info.wunderlist ? "wunderlist." : ""

				for (var i=0; i<atts.length; i++) {
					var att = atts[i];
					delAttachments[att.name] = {size: att.size, del: true};
				}

				info.delAttachments = delAttachments;
				info.fwdAttachments = fwdAttachments;
				that.sendMsgFile(info);
			}
		};
		MsgHdrToMimeMessage(msgHdr,null,mimeCallback);
	}
};

window.addEventListener("load", function(){gsend_to_wunderlist.init()}, false);
window.addEventListener("close", function(){gsend_to_wunderlist.finalize()}, false);

var gsend_to_wunderlistUtils = {
	limitPremium: [50, 250], //[size max, sent max]
	limitStandard: [25, 50], //[size max, sent max]

	//change local date to california date
	localDateToEnDate: function(date) {
		var localTime = date.getTime();
		var gmt = localTime + date.getTimezoneOffset() * 60 * 1000;
		var enDate = new Date(gmt + (-8 * 60 * 60 * 1000));
		return enDate;
	},
	
	writeStringToFile: function(name, str) {
		var file = Components.classes["@mozilla.org/file/directory_service;1"]
									.getService(Components.interfaces.nsIProperties)
									.get("ProfD", Components.interfaces.nsILocalFile);
		file.append("send_to_wunderlist");
		file.append(name);
		if (file.exists()) {
			file.remove(true);
		}
		file.create(file.NORMAL_FILE_TYPE, 0666);
		
		var ioService = Components.classes['@mozilla.org/network/io-service;1']
											.getService(Components.interfaces.nsIIOService);

		var fileStream = Components.classes['@mozilla.org/network/file-output-stream;1']
											.createInstance(Components.interfaces.nsIFileOutputStream);
		fileStream.init(file, 2, 0x200, false);

		var converterStream = Components
				.classes['@mozilla.org/intl/converter-output-stream;1']
				.createInstance(Components.interfaces.nsIConverterOutputStream);
		converterStream.init(fileStream, "UTF-8", 0,
												 Components.interfaces.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
		converterStream.writeString(str);
		converterStream.close();
		fileStream.close();
	},
	
	loadFileToString: function(name) {
		var ret = "";
		try {
			var file = Components.classes["@mozilla.org/file/directory_service;1"]
										.getService(Components.interfaces.nsIProperties)
										.get("ProfD", Components.interfaces.nsILocalFile);
			file.append("send_to_wunderlist");
			file.append(name);
		
			if (file.exists()) {
				var stream = Components.classes['@mozilla.org/network/file-input-stream;1'].createInstance(Components.interfaces.nsIFileInputStream);
			  stream.init(file, 1, 0, false);
		  	var converterStream = Components
						.classes['@mozilla.org/intl/converter-input-stream;1']
						.createInstance(Components.interfaces.nsIConverterInputStream);
				converterStream.init(stream, "UTF-8", stream.available(),
														 Components.interfaces.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
				var fileObj = {};
				converterStream.readString(stream.available(), fileObj);
				converterStream.close();
				stream.close();
				ret = fileObj.value ? fileObj.value : "";
			}
		} catch(e) {
			ret = "";
		}
		return ret;
	},
	
	getFileInst: function(name) {
		var file = Components.classes["@mozilla.org/file/directory_service;1"]
									.getService(Components.interfaces.nsIProperties)
									.get("ProfD", Components.interfaces.nsILocalFile);
		file.append("send_to_wunderlist");
		file.append(name);
		
		return file;
	}
}

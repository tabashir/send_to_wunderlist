var gENFTagList = {
	arg: null,
	ids: [],
	onLoad: function() {
		this.arg = window.arguments[0];
		this.arg.isOK = false;
		var tagService = Components.classes["@mozilla.org/messenger/tagservice;1"]
		  .getService(Components.interfaces.nsIMsgTagService);
		var tagArray = tagService.getAllTags({});
		var tagCount = tagArray.length;
		var tagList = document.getElementById("ENFTagList");
		var ignoredTags = this.arg.tags;
		for (var i=0; i<tagCount; i++) {
			var listitem = document.createElement("listitem");
			listitem.setAttribute("type", "checkbox");
			var key = tagArray[i].key;
			var name = tagArray[i].tag;
			var color = tagArray[i].color;
			if (ignoredTags.indexOf(key) < 0) {
				listitem.setAttribute("checked", true);
			}
			listitem.setAttribute("label", name);
			listitem.setAttribute("value", key);
			listitem.setAttribute("allowevents", true);
			listitem.setAttribute("id", "ENFTagItem"+i);
			listitem.addEventListener("click", function(event){gENFTagList.toggleCheckBox(event)}, false);
			this.ids.push("ENFTagItem"+i);
			listitem.style.color = color;
			tagList.appendChild(listitem);
		}
	},
	
	onAccept: function() {
		var len = this.ids.length;
		var ret = [];
		for (var i=0; i<len; i++) {
			var item = document.getElementById(this.ids[i]);
			if (!item.getAttribute("checked")) ret.push(item.getAttribute("value"));
		}
		
		this.arg.tags = ret;
		this.arg.isOK = true;
	}
};
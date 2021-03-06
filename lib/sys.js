var fs = require("fs");
var path = require("path");
var yaml = require("yaml");
var normalizeNewline = require("normalize-newline");
var config = require("./configs");
var preloadAbbreviations = require("./preload").preloadAbbreviations;
var cwd = process.cwd();

if (fs.existsSync(config.path.src && path.join(config.path.src, "..", "citeproc_commonjs.js"))) {
    try {
        var CSL = require(path.join(config.path.src, "..", "citeproc_commonjs.js"));
    } catch (err) {
        console.log("ERROR: syntax error in processor code");
        console.log(err);
        process.exit();
    }
} else {
    var CSL = require("citeproc");
}

var Sys = function(config, test, logger_queue){
    this.config = config;
    this.test = test;
    this._acache = {};
    this._acache["default"] = new CSL.AbbreviationSegments();
    this._setCache();
    this.logger_queue = logger_queue;
    this._abbrevsLoadedFor = {};
    if (this.test.OPTIONS) {
        for (var option in this.test.OPTIONS) {
            this[option] = this.test.OPTIONS[option];
        }
    }
    this.CSL = CSL;
}

Sys.prototype.print = function(txt) {
    var name = this.test.NAME;
    this.logger_queue.push("[" + name + "] " + txt);
}

Sys.prototype._setCache = function() {
    this._cache = {};
    this._ids = [];
    for (var item of this.test.INPUT) {
        this._cache[item.id] = item;
        this._ids.push(item.id);
    }
}

Sys.prototype.retrieveItem = function(id){
    var ret = this._cache[id];
    return ret;
};

Sys.prototype.retrieveLocale = function(lang){
    var ret = null;
    try {
        ret = fs.readFileSync(path.join(this.config.path.locale, "locales-"+lang+".xml")).toString();
        ret = ret.replace(/\s*<\?[^>]*\?>\s*\n/g, "");
    } catch (e) {
        ret = false;
    }
    return ret;
};

Sys.prototype.retrieveStyleModule = function(jurisdiction, preference) {
    var ret = null;
    if (this.test.submode.nojuris) {
        return ret;
    }
    var id = [jurisdiction];
    if (preference) {
        id.push(preference);
    }
    id = id.join("-");
    id = id.replace(/\:/g, "+");
    try {
        ret = fs.readFileSync(path.join(this.config.path.modules, "juris-" + id + ".csl")).toString();
    } catch (e) {}
    return ret;
};

// getAbbreviation(state.opt.styleID, state.transform.abbrevs, jurisdiction, category, orig, itemType, true);

Sys.prototype.getAbbreviation = function(dummyListNameVar, obj, jurisdiction, category, key){
    // this.print(JSON.stringify(this._acache, null, 2));

    if (!this._acache[jurisdiction]) {
        this._acache[jurisdiction] = new CSL.AbbreviationSegments();
    }
    var jurisdictions = ["default"];
    if (jurisdiction !== "default") {
        var lst = jurisdiction.split(":");
        for (var i=1,ilen=lst.length+1; i<ilen; i++) {
            jurisdiction = lst.slice(0,i).join(":");
            jurisdictions.push(jurisdiction);
        }
    }
    jurisdictions.reverse();
    var haveHit = false;
    for (var i = 0, ilen = jurisdictions.length; i < ilen; i += 1) {
        var myjurisdiction = jurisdictions[i];
        if (!obj[myjurisdiction]) {
            obj[myjurisdiction] = new CSL.AbbreviationSegments();
        }
        if (this._acache[myjurisdiction] && this._acache[myjurisdiction][category] && this._acache[myjurisdiction][category][key]) {
            obj[myjurisdiction][category][key] = this._acache[myjurisdiction][category][key];
            haveHit = true;
            break;
        }
    }
    return myjurisdiction;
};

Sys.prototype.preloadAbbreviationSets = function(myconfig) {
    if (!myconfig.path.jurisAbbrevPath) return;
    for (var itemID in this._cache) {
        var item = this._cache[itemID];
        var jurisdiction = item.jurisdiction;
        if (!jurisdiction) continue;
        
        var country = jurisdiction.replace(/:.*$/, "");
        var language = item.language ? item.language : "default";
        if (!this._abbrevsLoadedFor[country]) {
            this._abbrevsLoadedFor[country] = {};
        }
        // 1. Load each element of jurisdictionPreference
        // 2. Load item locale (split)
        // 3. Load style locale (split)
        // 4. Load default
        
        if (this._abbrevsLoadedFor[country]) continue;
        var jurisAbbrevFilePath = path.join(myconfig.path.jurisAbbrevPath, "auto-" + country + ".json");
        if (fs.existsSync(jurisAbbrevFilePath)) {
            var abbrevs = JSON.parse(fs.readFileSync(jurisAbbrevFilePath)).xdata;
            this._acache = Object.assign(this._acache, abbrevs);
        }
        this._abbrevsLoadedFor[country] = true;
    }
}

Sys.prototype.updateDoc = function() {
    var data, result;
    for (var i=0,ilen=this.test.CITATIONS.length;i<ilen;i++) {
        var citation = this.test.CITATIONS[i];
        [data, result] = this.style.processCitationCluster(citation[0], citation[1], citation[2]);
        // To get the indexes right, we have to do removals first.
        for (var j=this.doc.length-1; j>-1; j--) {
            var citationID = this.doc[j].citationID;
            if (!this.style.registry.citationreg.citationById[citationID]) {
                this.doc = this.doc.slice(0, j).concat(this.doc.slice(j + 1));
            }
        }
        // Fix the sequence of citations to reflect that in pre- and post-
        var prePost = citation[1].concat(citation[2]);
        var posMap = {};
        for (var j=0,jlen=prePost.length;j<jlen;j++) {
            posMap[prePost[j][0]] = j;
        }
        this.doc.sort(function(a, b) {
            if (posMap[a.citationID] > posMap[b.citationID]) {
                return 1;
            } else if (posMap[a.citationID] < posMap[b.citationID]) {
                return -1;
            } else {
                return 0;
            }
        });
        // Reset prefixes of any elements that exist in doc.
        for (var j in this.doc) {
            this.doc[j].prefix = "..";
        }
        // If citationID matches in doc, just replace the existing one.
        for (var j in result) {
            var insert = result[j];
            for (var k in this.doc) {
                var cite = this.doc[k];
                if (cite.citationID === insert[2]) {
                    // replace cite with insert, somehow
                    this.doc[k] = {
                        prefix: ">>",
                        citationID: cite.citationID,
                        String: insert[1]
                    };
                    result[j] = null;
                    break;
                }
            }
        }
        // For citationIDs that don't yet exist in doc, insert at the specified index locations.
        for (var j in result) {
            var insert = result[j];
            if (!insert) {
                continue;
            }
            this.doc = this.doc.slice(0, insert[0]).concat([
                {
                    prefix: ">>",
                    citationID: insert[2],
                    String: insert[1]
                }
            ]).concat(this.doc.slice(insert[0]));
        }
    }
};


Sys.prototype.normalizeAbbrevsKey = function(variable, key) {
	// Strip periods, normalize spacing, and convert to lower or upper case, depending on varname
	key = key ? ("" + key).trim() : "";
	if (["jurisdiction", "country"].indexOf(variable) > -1) {
		return key.toUpperCase();
	} else {
		key = key.toString()
			.replace(/(?:\b|^)(?:and|et|y|und|l[ae]|the|[ld]')(?:\b|$)|[\x21-\x2C.\/\x3A-\x40\x5B-\x60\\\x7B\x7D-\x7E]/ig, "")
			.replace(/\s*\x7C\s*/g, "\x7C")
			.replace(/\./g, " ")
			.replace(/\s+/g, " ")
			.trim();
		return key.toLowerCase();
	}
};

Sys.prototype.run = function(){
    var len, pos, ret, id_set;
    var ret = [];
    function variableWrapper(params, prePunct, str, postPunct) {
        //print(JSON.stringify(params,null,2));
        if (params.variableNames[0] === 'title' 
            && params.itemData.URL 
            && params.context === "citation" 
            && params.position === "first") {

            return prePunct + '<a href="' + params.itemData.URL + '">' + str + '</a>' + postPunct;
        } else if (params.variableNames[0] === 'first-reference-note-number' 
                   && params.context === "citation" 
                   && params.position !== "first") {

            return prePunct + '<b>' + str + '</b>' + postPunct;
        } else {
            return (prePunct + str + postPunct);
        }
    }


    if (this.test.OPTIONS && this.test.OPTIONS.variableWrapper) {
        this.variableWrapper = variableWrapper;
    }
    var lang_bases_needed = {};
    for (var lang in CSL.LANGS) {
        var lang_base = lang.split("-")[0];
        lang_bases_needed[lang_base] = true;
    } 
    for (var lang_base in lang_bases_needed) {
        if (!CSL.LANG_BASES[lang_base]) {
            throw "ERROR: missing in CSL.LANG_BASES: " + lang_base;
        }
    }
    var testCSL = this.test.CSL;
    var me = this;
    CSL.debug = function(str) {
        me.print(str);
    }
    this.style = new CSL.Engine(this,testCSL);
    
    this.style.fun.dateparser.addDateParserMonths(["ocak", "Şubat", "mart", "nisan", "mayıs", "haziran", "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık", "bahar", "yaz", "sonbahar", "kış"]);

    if (!this.test.MODE) {
        this.test.MODE = "all";
    }
    var mode = this.test.MODE.split("-");
    this.test.submode = {};
    for (var i=1,ilen=mode.length;i<ilen;i++) {
        this.test.submode[mode[i]] = true;
    }
    this.test.MODE = mode[0];

    if (this.test.submode["rtf"]) {
        this.style.setOutputFormat("rtf");
    }
    if (this.test.submode["plain"]) {
        this.style.setOutputFormat("plain");
    }
    if (this.test.submode["asciidoc"]) {
        this.style.setOutputFormat("asciidoc");
    }
    if (this.test.submode["xslfo"]) {
        this.style.setOutputFormat("xslfo");
    }
    if (this.test.submode["suppress_trailing_punctuation"]) {
        this.style.citation.opt.suppressTrailingPunctuation = true;
    }
    //this.style.setParseNames(true);
    //this.style.opt.development_extensions.static_statute_locator = true;
    //this.style.opt.development_extensions.clobber_locator_if_no_statute_section = true;
    //this.style.opt.development_extensions.handle_parallel_articles = true;
	for (var opt in this.test.OPTIONS) {
        if (opt === "variableWrapper") {
            continue;
        }
		this.style.opt.development_extensions[opt] = this.test.OPTIONS[opt];
	}
    var langParams = {
        persons:["translit"],
        institutions:["translit"],
        titles:["translit", "translat"],
        journals:['translit'],
        publishers:["translat"],
        places:["translat"]
    };
    var langs = {};
    if (this.test.LANGPARAMS) {
        for (var key in this.test.LANGPARAMS) {
            if (key === "langs") {
                langsToUse = this.test.LANGPARAMS[key];
                if (langsToUse.translat) {
                    this.style.setLangTagsForCslTranslation(langsToUse.translat);
                }
                if (langsToUse.translit) {
                    this.style.setLangTagsForCslTransliteration(langsToUse.translat);
                }
                continue;
            } else {
                langParams[key] = this.test.LANGPARAMS[key];
            }
        }
    }
    this.style.setLangPrefsForCites(langParams);
    if (this.test.MULTIAFFIX) {
        this.style.setLangPrefsForCiteAffixes(this.test.MULTIAFFIX);
    }
    if (this.test.ABBREVIATIONS) {
        var abbrevs = {};
        for (var jurisd in this.test.ABBREVIATIONS) {
            abbrevs[jurisd] = {};
            for (var segment in this.test.ABBREVIATIONS[jurisd]) {
                abbrevs[jurisd][segment] = {};
                for (var key in this.test.ABBREVIATIONS[jurisd][segment]) {
                    var isJurisdiction = jurisd === "default" && segment === "place" && key.toUpperCase() === key;
                    var isCourt = ["institution-entire", "institution-part"].indexOf(segment) > -1 && segment.toLowerCase() === segment;
                    if (!isJurisdiction && !isCourt) {
                        var normkey = this.normalizeAbbrevsKey("title", key);
                    } else {
                        var normkey = key;
                    }
                    abbrevs[jurisd][segment][normkey] = this.test.ABBREVIATIONS[jurisd][segment][key];
                }
            }
        }
        this._acache = Object.assign(this._acache, abbrevs);
    }
    // override preload
    if (this.test.BIBENTRIES){
        for (i=0,ilen=this.test.BIBENTRIES.length;i<ilen;i++) {
            var id_set = this.test.BIBENTRIES[i];
            this.style.updateItems(id_set, this.test.submode["nosort"]);
        }
    } else if (!this.test.CITATIONS) {
        this.style.updateItems(this._ids, this.test.submode["nosort"]);
    }
    if (!this.test["CITATION-ITEMS"] && !this.test.CITATIONS){
        var citation = [];
        for (var i=0,ilen=this.style.registry.reflist.length;i<ilen;i++) {
            var item = this.style.registry.reflist[i];
            citation.push({"id":item.id});
        }
        this.test["CITATION-ITEMS"] = [citation];
    }
    // preload
    if (!this.test.ABBREVIATIONS) {
        if (this.test.MODE === "all") {
            var mycitation = {
                citationItems: citation
            };
            preloadAbbreviations(CSL, this.style, mycitation, this._acache);
        } else {
            if (this.test["CITATION-ITEMS"]) {
                for (var citationItems of this.test["CITATION-ITEMS"]) {
                    var mycitation = {
                        citationItems: citationItems
                    };
                    preloadAbbreviations(CSL, this.style, mycitation, this._acache);
                }
            } else if (this.test["CITATIONS"]) {
                for (var mycitation of this.test["CITATIONS"]) {
                    preloadAbbreviations(CSL, this.style, mycitation[0], this._acache);
                }
            }
        }
    }

    if (this.test.MODE === "all") {
        // EVERYTHING
        var res = [];
        var item = citation[0];
        res.push("FIRST\n  " + this.style.makeCitationCluster(citation));
        item.locator = "123";
        res.push("FIRST w/LOCATOR\n  " + this.style.makeCitationCluster(citation));
        item.label = "paragraph";
        res.push("FIRST w/LABEL\n  " + this.style.makeCitationCluster(citation));
        delete item.locator;
        delete item.label;
        if (this.config.styleCapabilities.ibid) { 
            item.position = CSL.POSITION_IBID;
            res.push("IBID\n  " + this.style.makeCitationCluster(citation));
            item.position = CSL.POSITION_IBID_WITH_LOCATOR;
            item.locator = "123";
            res.push("IBID w/LOCATOR\n  " + this.style.makeCitationCluster(citation));
            delete item.locator;
        }
        if (this.config.styleCapabilities.position) {
            item.position = CSL.POSITION_SUBSEQUENT;
            item["near-note"] = true;
            res.push("SUBSEQUENT\n  " + this.style.makeCitationCluster(citation));
            item.locator = "123";
            res.push("SUBSEQUENT w/LOCATOR\n  " + this.style.makeCitationCluster(citation));
            delete item.locator;
        }
        if (this.config.styleCapabilities.backref) {
            item["first-reference-note-number"] = "1";
            res.push("SUBSEQUENT w/BACKREF\n  " + this.style.makeCitationCluster(citation));
            item.locator = "123";
            res.push("SUBSEQUENT w/BACKREF+LOCATOR\n  " + this.style.makeCitationCluster(citation));
            delete item.locator;
            delete item["first-reference-note-number"];
            delete item.position;
        }
        delete this.test["CITATION-ITEMS"];
        if (this.config.styleCapabilities.bibliography) {
            var bibres = this.style.makeBibliography();
            res.push("BIBLIOGRAPHY")
            res.push(bibres[0]["bibstart"] + bibres[1].join("") + bibres[0]["bibend"]);
        }
        ret = res.join("\n");
    } else {
        var citations = [];
        if (this.test["CITATION-ITEMS"]){
            for (var i=0,ilen=this.test["CITATION-ITEMS"].length;i<ilen;i++) {
                var citation = this.test["CITATION-ITEMS"][i];
                citations.push(this.style.makeCitationCluster(citation));
            }
        } else if (this.test.CITATIONS){
            this.doc = [];
            this.updateDoc();
            if (this.test.INPUT2) {
                this.test.INPUT = this.test.INPUT2;
                this._setCache();
                this.updateDoc();
            }
            citations = this.doc.map(function(elem, idx) {
                return elem.prefix + "[" + idx + "] " + elem.String;
            });
        }
        ret = citations.join("\n");
        if (this.test.MODE == "bibliography" && !this.test.submode["header"]){
            if (this.test.BIBSECTION){
                var ret = this.style.makeBibliography(this.test.BIBSECTION);
            } else {
                var ret = this.style.makeBibliography();
            }
            ret = ret[0]["bibstart"] + ret[1].join("") + ret[0]["bibend"];
        } else if (this.test.MODE == "bibliography" && this.test.submode["header"]){
            var obj = this.style.makeBibliography()[0];
            var lst = [];
            for (var key in obj) {
                var keyval = [];
                keyval.push(key);
                keyval.push(obj[key]);
                lst.push(keyval);
            }
            lst.sort(
                function (a, b) {
                    if (a > b) {
                        return 1;
                    } else if (a < b) {
                        return -1;
                    } else {
                        return 0;
                    }
                }
            );
            ret = "";
            for (pos = 0, len = lst.length; pos < len; pos += 1) {
                ret += lst[pos][0] + ": " + lst[pos][1] + "\n";
            }
            ret = ret.replace(/^\s+/,"").replace(/\s+$/,"");
        }
    }
    if (["citation", "bibliography", "all"].indexOf(this.test.MODE) === -1) {
        throw "Invalid mode in test file " + this.NAME + ": " + this.test.MODE;
    }
    ret = normalizeNewline(ret);
    return ret;
};
module.exports = Sys;

var ZipEntry = require("./zipEntry"),
    Headers = require("./headers");
    Utils = require("./util");

module.exports = function(/*String|Buffer*/input, /*Number*/inputType) {
    var entryList = [],
        entryTable = {},
        _comment = new Buffer(0),
        filename = "",
        fs = require("fs"),
        inBuffer = null,
        mainHeader = new Headers.MainHeader();

    if (inputType == Utils.Constants.FILE) {
        // is a filename
        filename = input;
        inBuffer = fs.readFileSync(filename);
        readMainHeader();
    } else if (inputType == Utils.Constants.BUFFER) {
        // is a memory buffer
        inBuffer = input;
        readMainHeader();
    } else {
        // none. is a new file
    }

    function readEntries() {
        entryTable = {};
        entryList = new Array(mainHeader.diskEntries);  // total number of entries
        var index = mainHeader.offset;  // offset of first CEN header
        for(var i = 0; i < entryList.length; i++) {

            var tmp = index,
                entry = new ZipEntry(inBuffer);
            entry.header = inBuffer.slice(tmp, tmp += Utils.Constants.CENHDR);

            entry.entryName = inBuffer.slice(tmp, tmp += entry.header.fileNameLength);

            if (entry.header.extraLength) {
                entry.extra = inBuffer.slice(tmp, tmp += entry.header.extraLength);
            }

            if (entry.header.commentLength)
                entry.comment = inBuffer.slice(tmp, tmp + entry.header.commentLength);

            index += entry.header.entryHeaderSize;

            entryList[i] = entry;
            entryTable[entry.entryName] = entry;
        }
    }

    function readMainHeader() {
        var i = inBuffer.length - Utils.Constants.ENDHDR, // END header size
            n = Math.max(0, i - 0xFFFF), // 0xFFFF is the max zip file comment length
            endOffset = 0; // Start offset of the END header

        for (i; i >= n; i--) {
            if (inBuffer[i] != 0x50) continue; // quick check that the byte is 'P'
            if (inBuffer.readUInt32LE(i) == Utils.Constants.ENDSIG) { // "PK\005\006"
                endOffset = i;
                break;
            }
        }
        if (!endOffset)
            throw Utils.Errors.INVALID_FORMAT;

        mainHeader.loadFromBinary(inBuffer.slice(endOffset, endOffset + Utils.Constants.ENDHDR));
        if (mainHeader.commentLength) {
            _comment = inBuffer.slice(endOffset + Utils.Constants.ENDHDR);
        }
        readEntries();
    }

    return {
        /**
         * Returns an array of ZipEntry objects existent in the current opened archive
         * @return Array
         */
        get entries () {
            return entryList;
        },

        /**
         * Archive comment
         * @return {String}
         */
        get comment () { return _comment.toString(); },
        set comment(val) {
            mainHeader.commentLength = val.length;
            _comment = val;
        },

        /**
         * Returns a reference to the entry with the given name or null if entry is inexistent
         *
         * @param entryName
         * @return ZipEntry
         */
        getEntry : function(/*String*/entryName) {
            return entryTable[entryName] || null;
        },

        /**
         * Adds the given entry to the entry list
         *
         * @param entry
         */
        setEntry : function(/*ZipEntry*/entry) {
            entryList.push(entry);
            entryTable[entry.entryName] = entry;
            mainHeader.totalEntries = entryList.length;
        },

        /**
         * Removes the entry with the given name from the entry list.
         *
         * If the entry is a directory, then all nested files and directories will be removed
         * @param entryName
         */
        deleteEntry : function(/*String*/entryName) {
            var entry = entryTable[entryName];
            if (entry && entry.isDirectory) {
                var _self = this;
                this.getEntryChildren(entry).forEach(function(child) {
                    if (child.entryName != entryName) {
                        _self.deleteEntry(child.entryName)
                    }
                })
            }
            entryList.slice(entryList.indexOf(entry), 1);
            delete(entryTable[entryName]);
            mainHeader.totalEntries = entryList.length;
        },

        /**
         *  Iterates and returns all nested files and directories of the given entry
         *
         * @param entry
         * @return Array
         */
        getEntryChildren : function(/*ZipEntry*/entry) {
            if (entry.isDirectory) {
                var list = [],
                    name = entry.entryName,
                    len = name.length;

                entryList.forEach(function(zipEntry) {
                    if (zipEntry.entryName.substr(0, len) == name) {
                        list.push(zipEntry);
                    }
                });
                return list;
            }
            return []
        },

        /**
         * Returns the zip file
         *
         * @return Buffer
         */
        toBuffer : function() {
            entryList.sort(function(a, b) {
                var nameA = a.entryName.toLowerCase( );
                var nameB = b.entryName.toLowerCase( );
                if (nameA < nameB) {return -1}
                if (nameA > nameB) {return 1}
                return 0;
            });

            var totalSize = 0,
                data = [],
                header = [],
                dindex = 0;

            mainHeader.size = 0;
            mainHeader.offset = 0;

            entryList.forEach(function(entry) {
                entry.header.offset = dindex;
                var compressedData = entry.getCompressedData();
                dindex += compressedData.length;
                data.push(compressedData);

                var headerData = entry.packHeader();
                header.push(headerData);
                mainHeader.size += headerData.length;
                totalSize += compressedData.length + headerData.length;
            });

            totalSize += mainHeader.mainHeaderSize;
            // point to end of data and begining of central directory first record
            mainHeader.offset = dindex;

            dindex = 0;
            var outBuffer = new Buffer(totalSize);
            data.forEach(function(content) {
                content.copy(outBuffer, dindex); // write data
                dindex += content.length;
            });
            header.forEach(function(content) {
                content.copy(outBuffer, dindex); // write data
                dindex += content.length;
            });

            var mainHeader = mainHeader.toBinary();
            if (_comment) {
                _comment.copy(mainHeader, Utils.Constants.ENDHDR);
            }

            mainHeader.copy(outBuffer, dindex);

            return outBuffer
        },

        toAsyncBuffer : function(/*Function*/callback) {

        }
    }
};

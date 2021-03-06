/*
 * grunt-squaredup-docbase
 * https://github.com/mateus/DocbaseGrunt
 *
 * Copyright (c) 2015 Mateus Freira
 * Licensed under the MIT license.
 */

'use strict';

module.exports = function(grunt) {

  // Please see the Grunt documentation for more information regarding task
  // creation: http://gruntjs.com/creating-tasks

  grunt.registerMultiTask('squaredup-docbase', 'Grunt plugin to generate html files from your docbase project.', function() {
    var ProgressBar = require('progress');
    var done = this.async();
    var options = this.options({
      generatePath: 'html/',
      //mapFile: 'docbase.json',
      configJsFile: 'docbase-config.js',
      baseUrl: '',
      checkLoadedSelector: "[role='flatdoc-menu']",
      checkNavbar: ".map_folder",
      urlToAccess: "http://localhost:9001/",
      assets: ['bower_components', 'styles', 'scripts', 'images'],
      linksSelector: '[ng-href]',
      linksVersions: '.version-switcher a',
      rootDocument: 'html',
      generateSearchIndex: true,
      onlysearchIndex: false,
      generateHtml: true,
      enableCrawlerDebug: false,
      startDocument: '<html>',
      endDocument: '</html>',
      searchIndexSelector: "h1, h2, h3, p, ul",
      operation: 'series'
    });
    grunt.log.writeln("Starting...");
    var util = require("./lib/util.js");
    var fs = require("fs");
	var lunr = require("lunr");
    var termsToBaseURLReplace = ['src="', 'href="', "src=", "href="];
    var baseReplace = ['base href="'];
    var urlToFielName = util.urlToFielName;
    var getPageLinks = util.getPageLinks;
    var inQuotes = util.inQuotes;
    var mapFile = null;
    var configData = null;
    var currentLinksIn = [];
    var currentId = 0;
    var makeCrawlercount = 0;
    var currentLinksTemp = [];
    var progressStart = false;
    var bar;
    var versionsLink = [];
    var pageInfo = {
      pageSize: 3,
      totalPage: 0,
      currentPage: 0,
      pageCounter: 0,
      totalCounter: 0
    };

    if (options.mapFile) {
      mapFile = grunt.file.readJSON(options.mapFile);
    } else {
      eval(fs.readFileSync(options.configJsFile) + " configData = docbaseConfig;");
    }
    if (configData.versions) {
      mapFile = configData.versions;
    }
    versionsLink = util.versionLinks(mapFile);
    var phantom = require('phantom');
    var pages = [];
    var links = [];
    var crawled = {};
	
    var searchIndex = lunr(function () {
	  this.ref('link');
	  this.field('title', { boost: 35 });
	  this.field('content');
	  this.field('keywords', { boost: 50 });
	});
	var searchStore = {};
	
    var indexdLinks = [];
    var clearFolder = function(srcpath) {
      if (grunt.file.isDir(srcpath)) {
        var files = grunt.file.expand(srcpath + "/*");
        files.forEach(clearFolder);
      } else {
        grunt.file.delete(srcpath);
      }
    };
    var moveAssets = function(srcpath) {
      if (grunt.file.isDir(srcpath)) {
        var files = grunt.file.expand(srcpath + "/*");
        files.forEach(moveAssets);
        if (srcpath.indexOf(options.generatePath) === -1 && srcpath !== './index.html' && srcpath !== './search-index.json' && srcpath.indexOf('node_modules') === -1) {
          grunt.log.writeln("Moving: ", srcpath);
        }
      } else {
        if (srcpath.indexOf(options.generatePath) === -1 && srcpath !== './index.html' && srcpath !== './search-index.json' && srcpath.indexOf('node_modules') === -1) {
          grunt.file.copy(srcpath, options.generatePath + srcpath)
        }
      }
    };
    var prepareAssets = function() {
      options.assets.forEach(function(srcpath) {
        moveAssets(srcpath);
      });
    }
    var checkQueueProcess = function(page, ph) {
      page.close();
      pages.shift();
      if (pages.length === 0) {
        if (!options.onlysearchIndex) {
			prepareAssets();			
        }
        setTimeout(function() {
          ph.exit();
          done();
        }, 0);
      }
    };
    var replaceBaseUrl = function(documentContent, fileName) {
      var nPaths = (fileName.match(/\//g) || []).length;
      var baseUrl = "";
      for (var i = nPaths - 2; i >= 0; i--) {
        baseUrl += "../";
      }
      var result = documentContent;
      baseReplace.forEach(function(term) {
        result = result.replace(new RegExp(term + './', 'g'), term + baseUrl);
      });
      return result;
    };
    var replaceLink = function(documentContent, from, to) {
      documentContent = documentContent.replace(new RegExp(inQuotes(from), 'g'), to);
      documentContent = documentContent.replace(new RegExp(from + "\#", 'g'), to + "#");
      return documentContent;
    };
    var replacePageLinks = function(documentContent) {
      versionsLink.forEach(function(version) {
        documentContent = replaceLink(documentContent, version.link, urlToFielName(version.realLink));
        documentContent = replaceLink(documentContent, urlToFielName(version.link), urlToFielName(version.realLink));
      });
      currentLinksIn.forEach(function(link) {
        var url = urlToFielName(link);
        documentContent = replaceLink(documentContent, link, url);
        documentContent = documentContent.replace(new RegExp(options.urlToAccess, 'g'), "");
      });
      return documentContent;
    };
    var makeCrawler = function(findLinks, once) {
      return function(currentLinks) {

        if (!findLinks) {
          currentLinksTemp = currentLinksTemp.concat(currentLinks);
          currentLinks.forEach(function(link) {
            links.push(link);
          });
          if (versionsLink.length == makeCrawlercount) {

            currentLinksTemp.forEach(function(v1, k1) {
              var flag = true;
              versionsLink.forEach(function(v2, k2) {
                if (v1 == v2.link) {
                  flag = false;
                }
              });
              if (flag && currentLinksIn.indexOf(v1) == -1) {
                currentLinksIn.push(v1);
              }
            });
            versionsLink.forEach(function(v2, k2) {
              currentLinksIn.push(v2.link);
            });
            crawlPage(options.urlToAccess, false, true, function(ph) {
              crawlChain(findLinks, once, ph);
            });
          }
        }
        if (findLinks) {
          makeCrawlercount++;
          currentLinks.forEach(function(link) {
            if (!once || !crawled[link]) {
              if (once) {
                crawled[link] = true;
              }
              links.push(link);
              crawlPage(options.urlToAccess + link, findLinks);
            }
          });
        }
      };
    };
    var makeGitCrawler = function(findLinks, once) {
      return function(currentLinks) {
        currentLinksIn = currentLinks;
        versionsLink.forEach(function(version) {
          currentLinksIn.push(version.link);
        });
        crawlPage(options.urlToAccess, false, true, function(ph) {
          crawlChain(findLinks, once, ph);
        });
      };
    };
    var chainEnd = function(ph) {	
		
		//save search index
		var path = options.generateHtml ? options.generatePath : '';       
		grunt.file.write(path + "search-index.json", JSON.stringify({
			index: searchIndex,
			store: searchStore
		}), 'w');
		grunt.log.writeln('Saved search index!');			
			
		prepareAssets();
		setTimeout(function() {
			ph.exit();
			if (configData.publish === 'local') {
			  serveStaticBuild();
			} else {
			  done();
			}
		}, 0);
    }
    var crawlChain = function(findLinks, once, ph) {
      if (!progressStart) {
        progressStart = true;
        bar = new ProgressBar('Progress ╢:bar╟ :percent :etas', {
          complete: '█',
          incomplete: '░',
          width: 50,
          total: currentLinksIn.length
        });

        pageInfo.totalPage = Math.floor(currentLinksIn.length / pageInfo.pageSize);
        pageInfo.totalCounter = currentLinksIn.length;
      }

      //Parallel Operaion
      if (options.operation == 'parallel') {
        if (pageInfo.currentPage <= pageInfo.totalPage) {
          var templLinks = currentLinksIn.slice(pageInfo.currentPage * pageInfo.pageSize, (pageInfo.currentPage + 1) * pageInfo.pageSize);
          templLinks.forEach(function(link, linkKey) {
            if (!once || !crawled[link]) {
              if (once) {
                crawled[link] = true;
              }
              links.push(link);

              var versionFlag = false;
              versionsLink.forEach(function(version) {
                if (version.link == link) {
                  versionFlag = true;
                }
              });
              if (!versionFlag) {
                versionFlag = link.indexOf('/index') == -1 ? false : true;
              }

              //if (linkKey == templLinks.length - 1) {
              crawlPage(options.urlToAccess + link, findLinks, versionFlag, function(ph, url, page) {
                pageInfo.pageCounter++;
                console.log('Done : ' + urlToFielName(url));
                if (pageInfo.pageCounter == (pageInfo.currentPage + 1) * pageInfo.pageSize) {
                  pageInfo.currentPage++;
                  crawlChain(findLinks, once, ph);
                }
                if (pageInfo.pageCounter == pageInfo.totalCounter) {
                  chainEnd(ph);
                }
                //page.close();
                setTimeout(function() {
                  ph.exit();
                }, 100);
              });

            }
          });
        }
      }

      //Series Operaion
      else if (options.operation == 'series') {
        var link = currentLinksIn[currentId];
        if (currentId < currentLinksIn.length) {
          if (!once || !crawled[link]) {
            if (once) {
              crawled[link] = true;
            }
            links.push(link);

            var versionFlag = false;
            versionsLink.forEach(function(version) {
              if (version.link == link) {
                versionFlag = true;
              }
            });
            if (!versionFlag) {
              versionFlag = link.indexOf('/index') == -1 ? false : true;
            }
            crawlPage(options.urlToAccess + link, findLinks, versionFlag, function(ph) {
              process.stdout.write("\u001b[2J\u001b[0;0H");
              bar.tick();
              setTimeout(function() {
                ph.exit();
              }, 100);
              crawlChain(findLinks, once, ph);
            });
          }
          currentId++;
        } else {
          chainEnd(ph);
        }
      }
    }
    var generateSearchIndex = function(page, url, ph, buildIndex, callback) {
      page.evaluate(function(selector, url) { //execute function in context of a page
	  
		var content = document.body.innerText; //get all content
		var title = document.querySelector('h1').innerText;
		var tokenizedKeywords = [];
		var yaml = document.querySelector('yaml');
		var path = url.substr(url.indexOf('#'));	
		
		//extract & tokenize keywords from yaml
		if(yaml && yaml.innerHTML) {
			var yamlLines = yaml.innerHTML.trim().split("\n"); // split yaml entries
			for(var x = 0; x < yamlLines.length; x++) {
				if(yamlLines[x].trim().substr(0, 8) === "keywords") { //find keywords entry
					var keywords = yamlLines[x].split(":"); //split on key/value separator		
					if(keywords && keywords.length > 1) { //if has value
						keywords = keywords[1].trim(); //trim whitespace
						tokenizedKeywords = keywords.split(" ");	//tokenize				
					}
				}
			}
		}	
				
		var item = {
			link: path,
			title: title,
			content: content,
			keywords: tokenizedKeywords
		};
		return item;
		
      }, function(item) { // process indexed elements   		
		if(item && item.link) {
			item.link = options.generateHtml ? urlToFielName(item.link) : item.link;
		}
		searchStore[item.link] = { //store a ref to some key details like the title (keyed by the link)
			title: item.title
		};
		
		searchIndex.add(item); //index the item
		
		setTimeout(function() {
			if (callback) {
				callback(ph, url);
			}
		});
		
      }, options.searchIndexSelector, url);
    };
    var generatePage = function(page, url, ph, callback) {
      page.evaluate(function(rootDocument) {
        return document.querySelector(rootDocument).innerHTML;
      }, function(documentContent) {

        var fileName = urlToFielName(url);
        documentContent = replaceBaseUrl(replacePageLinks(documentContent), fileName);
        if (options.generateHtml)
          grunt.file.write(options.generatePath + fileName, options.startDocument + documentContent + options.endDocument, 'w');       
        if (progressStart) {
          grunt.log.writeln("Generating:", options.generatePath + urlToFielName(url));
        }
        setTimeout(function() {
          if (callback) {
            callback(ph, url, page);
          }
        });
      }, options.rootDocument);

    };
    var crawlPage = function(url, findLinks, versionFlag, callback) {
      pages.push(url);
      phantom.create(function(ph) {
        ph.createPage(function(page) {
          page.set('settings.userAgent', 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/37.0.2062.120 Safari/537.36');
          page.open(url, function() {
            if (progressStart) {
              // process.stdout.write("\u001b[2J\u001b[0;0H");
              // bar.tick();
              console.log('\r\n');
              grunt.log.writeln("Reading: " + url);
            }
            util.waitFor({
              debug: false,
              interval: 100,
              timeout: 50000,
              checkLoadedSelector: options.checkLoadedSelector,
              checkNavbar: options.checkNavbar,
              check: function(check) {
                return !!document.querySelector(check);
              },
              success: function() {

                if (findLinks) {
                  getPageLinks(page, options.linksSelector, makeCrawler(false, false));
                  getPageLinks(page, options.linksVersions, makeCrawler(true, true));
                };
                if (!options.onlysearchIndex) {
                  if (options.generateSearchIndex) {
                    if (progressStart && !versionFlag)
                      generateSearchIndex(page, url);
                  }
                  generatePage(page, url, ph, callback);
                } else {
                  if (progressStart && !versionFlag) {
                    generateSearchIndex(page, url, ph, true, callback);
                  } else {
                    if (callback) {
                      callback(ph, url);
                    }
                  }
                }

              },
              error: function(e) {
                  grunt.log.writeln("Error generating page:", options.generatePath + urlToFielName(url));
                } // optional
            }, page);
          });
        });
      }, {
        parameters: {
          'ignore-ssl-errors': 'yes',
          'ssl-protocol': 'tlsv1',
          'web-security': false,
          'debug': options.enableCrawlerDebug.toString()
        }
      });
    };

    if (configData.publish === 'local') {
      check_bower();
    }
    else {
      initialize();
    }

    function check_bower() {
      fs.access('bower_components', fs.F_OK, function(err) {
        if (!err) {
          initialize();
        } else {
          var bowerInfo = '\nbower_components does not exists, ' +
            '\nTo install bower components run following commands in terminal.' +
            '\nnpm install -g bower' +
            '\nbower install';
          grunt.log.write(bowerInfo);
          done();
        }
      });
    }

    function initialize() {
		var manual_override = configData.hasOwnProperty('manual_override') ? configData.manual_override : false;
		crawlPage(options.urlToAccess, true);	
    }

    function serveStaticBuild() {
      var finalhandler = require('finalhandler');
      var http = require('http');
      var serveStatic = require('serve-static');
      var serve = serveStatic(options.generatePath, {
        'index': ['index.html']
      });
      var server = http.createServer(function(req, res) {
        var done = finalhandler(req, res)
        serve(req, res, done)
      });
      server.listen(1234);
      grunt.log.writeln('Docbase is published in build_html/. Check it out live at:  http://127.0.0.1:1234');
    };

  });
};
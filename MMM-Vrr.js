/* global Module */

/* Magic Mirror
 * Module: MMM-Vrr
 *
 * By Steven Zemelka <hello@klizzy.com>
 * MIT Licensed.
 */

Module.register("MMM-Vrr", {
  defaults: {
    displayType: "detail",
    updateInterval: 60000, // 1 minute
    retryDelay: 30000, // 30 seconds
    city: "Düsseldorf",
    station: "Hauptbahnhof",
    withoutDestination: [],
    platform: "",
    numberOfResults: 10,
    displayIcons: true,
    displayTimeOption: "countdown", // time, time+countdown
    setWidth: false,
    scrollAfter: false,
    lcdWidth: 450,
    line: ""
  },

  requiresVersion: "2.1.0", // Required version of MagicMirror
  delayStatus: 0,
  base64String: "",

  vrrBasicUrl: function () {
    return `https://vrrf.finalrewind.org/${this.config.city}/${this.config.station}`;
  },

  vrrJsonUrl: function () {
    return `${this.vrrBasicUrl()}.json?frontend=json`;
  },

  vrrLcdUrl: function () {
    return `${this.vrrBasicUrl()}.png?frontend=png`;
  },

  getUrl: function () {
    let url = "";
    if (this.isDisplayTypeLcd()) {
      url = this.vrrLcdUrl();
    } else {
      url = this.vrrJsonUrl();
    }
    url += `&no_lines=${this.config.numberOfResults}&line=${this.config.line}&platform=${this.config.platform}`;

    return url;
  },

  start: function () {
    let self = this;

    moment.locale(config.language);

    moment.updateLocale(config.language, {
      relativeTime: {
        s: this.translate("NOW"),
        m: "1 " + this.translate("MINUTE"),
        mm: "%d " + this.translate("MINUTE"),
        h: "+1 " + this.translate("HOUR"),
        hh: "%d " + this.translate("HOUR")
      }
    });

    //Flag for check if module is loaded
    this.loaded = false;

    // Schedule update timer.
    if (this.isDisplayTypeLcd()) {
      setInterval(function () {
        self.sendLcdImageUrlToSocket();
      }, this.config.updateInterval);
    } else {
      this.getData();
      setInterval(function () {
        self.updateDom();
      }, this.config.updateInterval);
    }
  },

  sendLcdImageUrlToSocket: function () {
    this.sendSocketNotification("MMM-VRR-SEND-IMAGE-URL", this.getUrl());
  },

  /**
   * gets the data from vrrf.finalrewind.org
   */
  getData: function () {
    let self = this;

    let urlApi = this.getUrl();
    let retry = true;

    let dataRequest = new XMLHttpRequest();
    dataRequest.open("GET", urlApi, true);
    dataRequest.onreadystatechange = function () {
      if (this.readyState === 4) {
        if (this.status === 200) {
          self.processData(JSON.parse(this.response));
        } else if (this.status === 401) {
          self.updateDom(self.config.animationSpeed);
          Log.error(self.name, this.status);
          retry = false;
        } else {
          Log.error(self.name, "Could not load data.");
        }
        if (retry) {
          self.scheduleUpdate(self.loaded ? -1 : self.config.retryDelay);
        }
      }
    };
    dataRequest.send();
  },

  /* scheduleUpdate()
   * Schedule next update.
   *
   * argument delay number - Milliseconds before next update.
   *  If empty, this.config.updateInterval is used.
   */
  scheduleUpdate: function (delay) {
    let self = this;
    let nextLoad = this.config.updateInterval;
    if (typeof delay !== "undefined" && delay >= 0) {
      nextLoad = delay;
    }
    setTimeout(function () {
      self.getData();
    }, nextLoad);
  },

  /**
   * checks if one line is behind schedule
   * @param apiResult
   * @returns {boolean}
   */
  delayExist: function (apiResult) {
    for (let i = 0; i < this.config.numberOfResults; i++) {
      if (apiResult.raw[i] === undefined) {
        continue;
      }

      if (apiResult.raw[i].delay > 0) {
        return true;
      }
    }
    return false;
  },

  isDisplayTypeLcd: function () {
    return this.config.displayType === "lcd";
  },

  /**
   * creates the MMM-Vrr Module
   * @returns {HTMLTableElement|HTMLImageElement}
   */
  getDom: function () {
    let self = this;

    if (this.isDisplayTypeLcd()) {
      let lcdWidth = "width:" + this.config.lcdWidth + "px";
      let tableWrapper = document.createElement("img");

      if (this.base64String === "") {
        tableWrapper.setAttribute("src", this.getUrl());
      } else {
        tableWrapper.setAttribute("src", this.base64String);
      }

      tableWrapper.setAttribute("style", lcdWidth);
      return tableWrapper;
    }

    let tableWrapper = document.createElement("table");
    tableWrapper.className = "small mmm-vrr-table";

    if (self.dataRequest) {
      if (self.config.setWidth) {
        let tableWidth = "width:" + self.config.setWidth + "px";
        tableWrapper.setAttribute("style", tableWidth);
      }

      let apiResult = self.dataRequest;
      let tableHeadRow = self.createTableHeader();
      tableWrapper.appendChild(tableHeadRow);
      let usableResults = self.removeResultsFromThePast(apiResult.raw);
      self.createTableContent(usableResults, tableWrapper);
    }
    return tableWrapper;
  },

  /**
   * creates the table header, row and the data for it
   * @returns {HTMLTableRowElement}
   */
  createTableHeader: function () {
    let self = this;
    let tableHeadRow = document.createElement("tr");
    tableHeadRow.className = "border-bottom";

    let tableHeadValues = [
      self.translate("LINE"),
      self.translate("TRACK"),
      self.translate("DESTINATION"),
      self.translate("DEPARTURE")
    ];

    if (this.delayExist(self.dataRequest)) {
      let delayClockIcon = '<i class="fa fa-clock-o"></i>';
      tableHeadValues.push(delayClockIcon);
    }

    for (let thCounter = 0; thCounter < tableHeadValues.length; thCounter++) {
      let tableHeadSetup = document.createElement("th");
      tableHeadSetup.innerHTML = tableHeadValues[thCounter];

      if (self.config.displayIcons) {
        if (thCounter === 0) {
          tableHeadSetup.setAttribute("colspan", "2");
        }
      }

      tableHeadRow.appendChild(tableHeadSetup);
    }
    return tableHeadRow;
  },

  /**
   * @param usableResults
   * @param tableWrapper
   * @returns {HTMLTableRowElement}
   */
  createTableContent: function (usableResults, tableWrapper) {
    let self = this;
    for (
      let trCounter = 0;
      trCounter < self.config.numberOfResults;
      trCounter++
    ) {
      let obj = usableResults[trCounter];
      if (obj === undefined) {
        continue;
      }

      // check destination
      if (self.config.withoutDestination.length > 0) {
        let found = false;
        for (
          let index = 0;
          index < self.config.withoutDestination.length;
          index++
        ) {
          if (obj["destination"] === self.config.withoutDestination[index]) {
            found = true;
          }
        }
        if (found == true) {
          // increasing numberOfResults
          self.config.numberOfResults += 1;
          continue;
        }
      }
      let trWrapper = document.createElement("tr");
      trWrapper.className = "tr";

      if (self.config.displayIcons) {
        let icon = self.createMatchingIcon(obj.type);
        trWrapper.appendChild(icon);
      }

      let remainingTime = self.calculateRemainingMinutes(
        obj.sched_date,
        obj.sched_time
      );
      let timeValue;
      switch (self.config.displayTimeOption) {
        case "time+countdown":
          timeValue = obj.sched_time + " (" + remainingTime + ")";
          break;
        case "time":
          timeValue = obj.sched_time;
          break;
        default:
          timeValue = remainingTime;
      }

      let adjustedLine = self.stripLongLineNames(obj);

      let tdValues = [adjustedLine, obj.platform, obj.destination, timeValue];

      if (this.delayExist(self.dataRequest)) {
        if (obj.delay > 0) {
          let delay = " +" + obj.delay;
          tdValues.push(delay);
        }
      }

      for (let c = 0; c < tdValues.length; c++) {
        let tdWrapper = document.createElement("td");

        if (
          tdValues[c].length > self.config.scrollAfter &&
          self.config.scrollAfter > 0
        ) {
          tdWrapper.innerHTML =
            '<marquee scrollamount="3" >' + tdValues[c] + "<marquee>";
        } else {
          tdWrapper.innerHTML = tdValues[c];
        }

        if (c === 4) {
          tdWrapper.className = "delay";
        }

        trWrapper.appendChild(tdWrapper);
      }
      tableWrapper.appendChild(trWrapper);
    }
  },

  /**
   * Removes results from the past
   * check calculateRemainingMinutes() for more details
   * @param apiResult
   * @returns {*}
   */
  removeResultsFromThePast: function (apiResult) {
    let self = this;
    let cleanedResults = [];
    for (let i = 0; i < apiResult.length; i++) {
      let singleRoute = apiResult[i];

      let isInPast = self.calculateRemainingMinutes(
        singleRoute.sched_date,
        singleRoute.time,
        true
      );

      if (!isInPast) {
        cleanedResults.push(apiResult[i]);
      }
    }

    return cleanedResults;
  },

  /**
   * Removes unnecessary long Transport Type name (like 'InterCityExpress")
   * @param routeData
   * @returns {XML|void|string}
   */
  stripLongLineNames: function (routeData) {
    return routeData.line.substr(0, 7);
  },

  /**
   * Manual Calculation for the remaining Time until departure
   * The API returns already the remaining Minutes, but the raw results seem to be oddly cached.
   * Without this method it resulted in a difference from up to 5 Minutes
   *
   * Alsow checks if the departure time is in the past, because we only want upcoming results.
   * @param departureDay - DD-MM-YYYY
   * @param departureTime - HH:mm
   * @param returnPastCheck
   */
  calculateRemainingMinutes: function (
    departureDay,
    departureTime,
    returnPastCheck = false
  ) {
    let dateAndTime = moment(
      departureDay + " " + departureTime,
      "DD-MM-YYYY HH:mm"
    );

    if (returnPastCheck) {
      let unixDifference = dateAndTime.diff(moment.now());
      return unixDifference < 0;
    }

    return dateAndTime.fromNow(true);
  },

  /**
   * Creates the right icon for the Route
   * @param transportType
   * @returns {Node}
   */
  createMatchingIcon: function (transportType) {
    let type = document.createElement("td");
    let symbolType;
    switch (transportType) {
      case "S-Bahn":
        symbolType = "train";
        break;
      case "U-Bahn":
        symbolType = "subway";
        break;
      case "InterCityExpress":
        symbolType = "train";
        break;
      case "TaxiBus":
        symbolType = "taxi";
        break;
      case "Stadtbahn":
        symbolType = "subway"; 
        break;
      default:
        symbolType = "bus";
        break;
    }
    let symbol = document.createElement("span");
    symbol.className = "fa fa-" + symbolType;

    type.appendChild(symbol);

    return type;
  },

  /**
   *  Define required styles.
   *  @returns {[string]}
   */
  getScripts: function () {
    return ["moment.js"];
  },

  /**
   * Define required styles.
   * @returns {[string,string]}
   */
  getStyles: function () {
    return ["MMM-Vrr.css", "font-awesome.css"];
  },

  /**
   * Load translations files
   * @returns {{en: string, de: string}}
   */
  getTranslations: function () {
    return {
      en: "translations/en.json",
      de: "translations/de.json"
    };
  },

  processData: function (data) {
    this.dataRequest = data;

    if (this.loaded === false) {
      this.updateDom(this.config.animationSpeed);
    }
    this.loaded = true;
  },

  // socketNotificationReceived from helper
  socketNotificationReceived: function (notification, base64ImageString) {
    if (notification === "base64ImageReceived") {
      this.base64String = base64ImageString;
      this.updateDom();
    }
  }
});

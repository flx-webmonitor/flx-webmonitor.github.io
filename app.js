Vue.config.devtools = true

var app = new Vue({
  el: '#app',
  data: {
    //example
    tasks: [],
    hideCompleted: false,
    newItemText: "",
    //end example
    fluxronImage: 'Logo_FLUXRON.png',
    login: false,
    userName: "",
    password: "",
    viewState: 1,
    statusTimeoutInit: 25,
    itemLimitOverview: 5,
    itemLimitFavorite: -1,
    myDevicesText: "Meine Auswahl",
    generatorList: [],
    task1sec: null,
    mqtt: null,
    reconnectTimeout: 2000,
    host: "spectacular-plumber.cloudmqtt.com",
    port: 443,
  },
  //called if the result is changing
  computed: {
    filteredTasks() {
      this.debugOut("computed: filteredTasks");
      return this.hideCompleted ?
        this.tasks.filter(t => !t.done) : this.tasks
    },
    filteredGeneratorList() {
      this.debugOut("computed: filteredGeneratorList");
      return this.generatorList.filter(t => t.favorite)
    },
    maxLengthStatus() {
      let maxStatusLength = 0;
      this.generatorList.forEach((item) => {
        if (Object.keys(item.status).length > maxStatusLength) {
          maxStatusLength = Object.keys(item.status).length;
        }
      })
      if (this.itemLimitFavorite > 0){
        if (this.itemLimitFavorite < maxStatusLength){
          maxStatusLength= this.itemLimitFavorite;
        }
      }
      this.debugOut("computed: maxStatusLength=" + maxStatusLength);
      return maxStatusLength;
    },
  },
  methods: {
    addNewTodo() {
      this.tasks.push({
        action: this.newItemText,
        done: false
      });
      this.storeData();
      this.newItemText = "";
    },
    storeData() {
      this.debugOut("storeData");
      localStorage.setItem("setup", JSON.stringify(this.hideCompleted));
      localStorage.setItem("todos", JSON.stringify(this.tasks));
      localStorage.setItem("genList", JSON.stringify(this.generatorList));
      this.$forceUpdate();
    },
    deleteCompleted() {
      this.tasks = this.tasks.filter(t => !t.done);
      this.storeData();
    },
    toggleDone(item) {
      this.debugOut(item.action + ":" + item.done);
      this.storeData();
    },
    toggleHideCompleted(value) {
      this.debugOut("hide completed:" + value);
      this.storeData();
    },
    btnDeviceOverview(event) {
      targetId = event.currentTarget.id;
      this.viewState = 1;
    },
    btnMyDevices() {
      this.viewState = 2;
    },
    onGenFavoriteChange() {
      this.debugOut("on gen favorite change");
      this.storeData();
    },
    moveUnit(genStatus) {
      let start = 0;
      let stop = 0;
      let newStatus = {};
      for (item in genStatus) {
        if (item.includes("[")) {
          start = item.indexOf("[");
          stop = item.indexOf("]");
          let key = item.replace(item.substring(start, stop + 1), "");
          let value = genStatus[item] + " " + item.substring(start + 1, stop);
          newStatus[key] = value;
        }
        else {
          newStatus[item] = genStatus[item];
        }
      };
      return newStatus;
    },

    onMsg: function (message) {
      if (message.destinationName.includes(this.userName)) {
        this.debugOut(message.destinationName + " : " + message.payloadString);
        //setup received -> update generatorList
        let userSetup = JSON.parse(message.payloadString);
        let userSetupDevices = userSetup.devices;
        if ("statusTimeout" in userSetup){
          this.statusTimeoutInit = userSetup.statusTimeout;
        }
        if ("itemLimitOverview" in userSetup){
          this.itemLimitOverview = userSetup.itemLimitOverview;
        }
        if ("itemLimitFavorite" in userSetup){
          this.itemLimitFavorite = userSetup.itemLimitFavorite;
        }
        //check if device is already in list
        userSetupDevices.forEach((setupSerNr, index) => {
          let foundIndex = -1;
          this.generatorList.forEach((item, index) => {
            if (item.serNr == setupSerNr) {
              foundIndex = index;
            }
          });
          if (foundIndex >= 0) {
            //already in list
            this.generatorList[foundIndex].conState = "offline";
            this.generatorList[foundIndex].timeout = 0;
          }
          else {
            //new in list
            let userSetupNewDevice = {};
            userSetupNewDevice.serNr = setupSerNr;
            userSetupNewDevice.conState = "offline";
            userSetupNewDevice.timeout = 0;
            userSetupNewDevice.favorite = false;
            userSetupNewDevice.statusOriginal = {};
            userSetupNewDevice.status = {};
            this.generatorList.push(userSetupNewDevice);
          }
        });
        //check for devices which can be removed
        for (var i = 0; i < this.generatorList.length; i++) {
          if (userSetupDevices.includes(this.generatorList[i].serNr)) {
            //subscribe
            this.debugOut("subscribe: FLX/WIFI/" + this.generatorList[i].serNr + "/status/#");
            this.mqtt.subscribe("FLX/WIFI/" + this.generatorList[i].serNr + "/status/#");
          }
          else {
            //remove item
            this.debugOut("remove: " + this.generatorList[i].serNr + " on index: " + i);
            this.generatorList.splice(i, 1);
            //adjust index
            i--;
          }
        }
        //new setup is ready -> store it
        this.storeData();
      }
      else {
        //status or event received
        this.generatorList.forEach((item, index) => {
          let splittedTopic = message.destinationName.split("/");
          if ((splittedTopic[2] == item.serNr) && (splittedTopic[3] == "status")) {
            if (splittedTopic[4] == "event") {
              let event = JSON.parse(message.payloadString);
              this.debugOut(event);
            }
            else {
              let status = JSON.parse(message.payloadString);
              this.generatorList[index].statusOriginal = status;
              this.generatorList[index].status = this.moveUnit(status);
              this.generatorList[index].conState = "online";
              this.generatorList[index].timeout = this.statusTimeoutInit;
            }
          }
        });
      }
      this.$forceUpdate();
    },
    onConnectionLost: function (response) {
      this.debugOut("connection lost: " + response.errorMessage);
      //stop timeout task
      clearInterval(this.task1sec);
      this.clearTimeouts();
      //try to reconnect
      if (this.login == true) {
        this.MQTTconnect();
      }
    },
    clearTimeouts: function () {
      this.debugOut("clear timeouts");
      this.generatorList.forEach((item, index) => {
        this.generatorList[index].timeout= 0;
        this.generatorList[index].conState = "offline";
        this.$forceUpdate();
      });
    },
    conStateTimeout: function () {
      //this.debugOut("run timeout 1sec timer");
      this.generatorList.forEach((item, index) => {
        if (this.generatorList[index].timeout > 0) {
          this.generatorList[index].timeout--;
        }
        else {
          this.generatorList[index].conState = "offline";
          this.$forceUpdate();
        }
      });
    },
    connectTimeout: function () {
      this.debugOut("connection timeout");
    },
    onConnect: function () {
      // Once a connection has been made, make a subscription and send a message.
      this.debugOut("connected");
      clearTimeout(this.connTimeout);
      this.login = true;
      this.mqtt.onMessageArrived = this.onMsg;
      this.mqtt.onConnectionLost = this.onConnectionLost;
      this.mqtt.subscribe("FLX/WIFI/" + this.userName + "/setup/#");
      this.task1sec = setInterval(this.conStateTimeout, 1000);

      //message = new Paho.MQTT.Message("Hello World");
      //message.destinationName = "sensor1";
      //mqtt.send(message);
    },
    MQTTconnect: function () {
      this.debugOut("connecting...");
      var currentdate = new Date().toLocaleString();
      this.mqtt = new Paho.MQTT.Client(this.host, this.port, "FLXwebmonitor " + currentdate);

      var options = {
        useSSL: true,
        timeout: 3,
        onSuccess: this.onConnect,
        userName: this.userName,
        password: this.password
      };
      this.connTimeout = setTimeout(this.connectTimeout, 3000);
      this.mqtt.connect(options); //connect
      this.password = "";
    },
    MQTTdisconnect: function () {
      this.debugOut("disconnected");
      this.mqtt.disconnect(); //disconnect
    },
    btn_ok_login: function () {
      //this.debugOut("Login User:" + this.userName + " Password:" + this.password);
      var myModalEl = document.getElementById("loginModal");
      var myModal = bootstrap.Modal.getInstance(myModalEl);
      myModal.hide();
      localStorage.setItem("user", this.userName);
      localStorage.setItem("userpw", this.password);
      this.MQTTconnect();
    },
    onLogout: function () {
      this.login = false;
      this.password = "";
      localStorage.setItem("user", this.userName);
      localStorage.setItem("userpw", this.password);
      this.MQTTdisconnect();
    },
    debugOut: function (output) {
      console.log(output);
    },
  },
  mounted() {
    console.log("mounted page");
    //try to auto connect
    if ((this.userName.length > 0) && (this.password.length > 0)) {
      this.MQTTconnect();
    }
  },
  created() {
    console.log("created page");
    let data = localStorage.getItem("todos");
    if (data != null) {
      this.tasks = JSON.parse(data);
    }
    let setup = localStorage.getItem("setup");
    if (setup != null) {
      this.hideCompleted = JSON.parse(setup);
    }
    let genList = localStorage.getItem("genList");
    if (genList != null) {
      this.generatorList = JSON.parse(genList);
    }
    let user = localStorage.getItem("user");
    if (user != null) {
      this.userName = user;
    }
    let userpw = localStorage.getItem("userpw");
    if (userpw != null) {
      this.password = userpw;
    }
    this.generatorList.forEach((item) => {
      item.timeout = 0;
    })
  },
})


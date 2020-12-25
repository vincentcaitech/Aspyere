import { database } from "firebase";
import React from "react";
import {
  fbTimestamp,
  pAuth,
  pFirestore,
  pFunctions,
} from "../../services/config";
import { PContext } from "../../services/context";
import EventsList from "./EventsList";
import GroupAdmin from "./GroupAdmin";
import LobbyPlatform from "./LobbyPlatform";
import MyStats from "./MyStats";
import PlatformAdmin from "./PlatformAdmin";
import personIcon from "../../images/person-icon.png";
import Loading from "../Loading";

class Platform extends React.Component {
  constructor() {
    super();
    this.state = {
      isLoadingPlatform: true, //set to false when done loading. Set it when you set isJoined
      isJoined: false,
      isGroupNotExist: false,
      isGroupAdmin: false, //is admin of this group.
      isAdmin: false, //if admin of whole platform
      platformSettings: {},
      groupData: {},
      userData: {},
      menuOption: 2, //0: Platform Admin, 1: Group Admin, 2: Events, 3: My Stats
      doesNotExist: false,
      privateSettings: {},
      privateGroupSettings: {},
      dbMapping: {}, //just for admin, see componentDidMount()
      isUnjoinError: false,
      isUnjoinLoading: false,
      allGroupUsers: [], //array of all users in this group, only fill out if groupAdmin,
      recentActivity: [],
      lastViewed: new Date(),
      unsubscribe: () => {},

      //for the EventsList:
      isPast: false,
      allEvents: [], //current/upcoming events, add by pagination
      pastEvents: [], //add to this by pagination,
      lastDocAllEvents: -1, //-1 to start from beginning, null to stop pagination. (-1 doesn't represent an index or anything, just there as a placeholder to know when to start)
      lastDocPastEvents: -1, //these both are document refs.
      limit: 3, //how much to at a time. Manually set this.

      //for completed events (in MyStats):
      completedEvents: [],
      lastDocCompletedEvents: -1,
    };
  }

  async componentDidMount() {
    var isFirstTime = true;
    try {
      var unsubscribe = pFirestore
        .collection("platforms")
        .doc(this.context.platform)
        .onSnapshot(async (doc) => {
          if (!doc.exists)
            return this.setState({
              doesNotExist: true,
              isLoadingPlatform: false,
            });
          var isAdmin = doc.data().admins.includes(pAuth.currentUser.uid);
          var databases = doc.data().databases;
          this.setState({
            platformSettings: { ...doc.data(), id: doc.id },
            isAdmin: isAdmin,
          });
          this.context.setPlatformName(doc.data().name);

          //first time, get this data just once. Snapshot listener updates when platform settings change. You don't want to do all this everytime the platform admin settings update.
          if (isFirstTime) {
            //isJoined will then getGroupData, which will then getLastViewed.
            await this.isJoined(doc.data().requireGroup);

            if (isAdmin) this.getPrivateSettings();
            isFirstTime = false;
            //HERE YOU SET THE SECOND STAGE TO FALSE
          }
          //Database Mapping
          if (isAdmin) {
            this.getDatabaseMapping(databases);
          }
        });
      this.setState({ unsubscribe: unsubscribe });
    } catch (e) {
      this.setState({ doesNotExist: true, isLoadingPlatform: false });
    }
  }

  //returns true or false if the user is in the platform or not
  //ALSO sets usersettings when it calls the database.
  isJoined = async (requireGroup) => {
    var doc = await pFirestore
      .collection("platforms")
      .doc(this.context.platform)
      .collection("users")
      .doc(pAuth.currentUser.uid)
      .get();
    if (!doc.exists) {
      return this.setState({ isJoined: false, isLoadingPlatform: false });
    } else {
      if (requireGroup) {
        //var userInfo = await pFirestore.collection("users").doc(pAuth.currentUser.uid).get();
        if (!doc.data().currentGroup) {
          return this.setState({
            isLoadingPlatform: false,
            isJoined: false,
            userData: { ...doc.data() },
          });
        } else {
          await this.getGroupData(doc.data().currentGroup);
          var userDataInGroup = await doc.ref
            .collection(doc.data().currentGroup)
            .doc("userData")
            .get();

          return this.setState({
            isLoadingPlatform: false,
            isJoined: true,
            userData: { ...doc.data(), ...userDataInGroup.data() },
          });
        }
      } else {
        //still need this, because even if you join indiidually, currentGroup is set to "individual", NOT null
        if (!doc.data().currentGroup) {
          return this.setState({
            isLoadingPlatform: false,
            isJoined: false,
            userData: { ...doc.data() },
          });
        }
        if (doc.data().currentGroup !== "individual") {
          //only do this if not individual join, or else it will say the group doesn't exists.
          await this.getGroupData(doc.data().currentGroup);
        } else {
          this.setState({ isGroupAdmin: false, menuOption: 2 });
        }

        //STILL do this for individual join, because there is still userData (aka the stats) for joining individually.
        var userDataInGroup = await doc.ref
          .collection(doc.data().currentGroup)
          .doc("userData")
          .get();

        return this.setState({
          isLoadingPlatform: false,
          isJoined: true,
          userData: { ...doc.data(), ...userDataInGroup.data() },
        });
      }
    }
  };

  componentWillUnmount() {
    this.state.unsubscribe();
  }

  //where you update the group users by using the last "true" parameter in getGroupAdminData
  getLastViewed = async (groupId) => {
    // var doc = await pFirestore
    //   .collection("platforms")
    //   .doc(this.context.platform)
    //   .collection("users")
    //   .doc(pAuth.currentUser.uid)
    //   .get();

    var fieldName = "lastViewedGroupAdmin" + groupId;
    var lastViewed = this.state.userData[fieldName]
      ? this.state.userData[fieldName].toDate()
      : new Date();
    this.setState({
      lastViewed: lastViewed,
    });
    await this.getGroupAdminData(lastViewed, new Date(), true);
    var updateUserViewTime = pFunctions.httpsCallable("updateUserViewTime");
    updateUserViewTime({
      platformId: this.context.platform,
      fieldName: fieldName,
    })
      .then(() => {})
      .catch((e) => console.log(e));
  };

  //only for Group Admin.
  getAllGroupUsers = async () => {
    var allUsers = await pFirestore
      .collection("platforms")
      .doc(this.context.platform)
      .collection("users")
      .where("currentGroup", "==", this.state.groupData.id)
      .get();
    var arr = [];
    allUsers.docs.forEach((user) => {
      arr.push({ id: user.id, data: user.data() });
    });
    this.setState({ allGroupUsers: arr });
    return arr;
  };

  //pass in a date object to get all records after that. Call everytime you want to add 7 days. (or however many days)
  getGroupAdminData = async (startDate, endDate, isRefreshUsers) => {
    var start = fbTimestamp.fromDate(startDate);
    var end = fbTimestamp.fromDate(endDate);
    var users;
    if (this.state.allGroupUsers.length == 0 || isRefreshUsers) {
      users = await this.getAllGroupUsers();
    } else {
      users = [...this.state.allGroupUsers];
    }
    var allRecords = [];
    users.forEach((user) => {
      allRecords.push(
        pFirestore
          .collection("platforms")
          .doc(this.context.platform)
          .collection("users")
          .doc(user.id)
          .collection(this.state.groupData.id)
          .where("timeSubmitted", ">=", start)
          .where("timeSubmitted", "<=", end)
          .get()
      );
    });
    var index = 0; //to match the record to the user.
    Promise.all(allRecords).then((allRecordsResolved) => {
      var recentActivity = [];
      allRecordsResolved.forEach((list) => {
        list.docs.forEach((e) => {
          var newE = { ...e.data() };
          newE.time = newE.timeSubmitted.toDate();
          newE.userId = users[index]["id"];
          delete newE.timeSubmitted;
          recentActivity.push(newE);
        });
        index++;
      });

      var newArr = [...this.state.recentActivity];
      //to ensure no duplicates
      recentActivity.forEach((a) => {
        if (!newArr.includes(a)) {
          newArr.push(a);
        }
      });
      //Sort DESCENDING time, so most recent first. REMEMBER: return an NUMBER (positive/negative) NOT a BOOLEAN!!!! This did not work if you return a comparison of times.
      newArr.sort((a, b) => b.time.getTime() - a.time.getTime());
      this.setState({ recentActivity: newArr });
    });
  };

  getPrivateSettings = () => {
    //Try to get the private settings
    try {
      pFirestore
        .collection("platforms")
        .doc(this.context.platform)
        .collection("privateSettings")
        .doc("privateSettings")
        .onSnapshot((doc) => {
          this.setState({ privateSettings: doc.data() });
        });
    } catch (e) {
      console.log(e, "Not admin");
    }
  };

  //will only update the mapping if a db is added, so you can call on each snapshot
  getDatabaseMapping = async (databases) => {
    databases.forEach(async (db) => {
      if (!this.state.dbMapping[db]) {
        try {
          var dbData = await pFirestore.collection("databases").doc(db).get();
          if (dbData.exists) {
            this.setState((prevState) => {
              var newDBMapping = prevState.dbMapping;
              newDBMapping[db] = dbData.data().name;
              return { dbMapping: newDBMapping };
            });
          }
        } catch (e) {
          console.log("Nonexistent Database Error");
        }
      }
    });
  };

  getGroupData = async (groupId) => {
    await pFirestore
      .collection("platforms")
      .doc(this.context.platform)
      .collection("groups")
      .doc(groupId)
      .get()
      .then(async (doc) => {
        console.log(groupId);
        if (!doc.exists) this.setState({ isGroupNotExist: true });
        this.setState({
          groupData: { ...doc.data(), id: doc.id },
          isGroupAdmin:
            doc.data().admins &&
            doc.data().admins.includes(pAuth.currentUser.uid),
          menuOption:
            doc.data().admins &&
            doc.data().admins.includes(pAuth.currentUser.uid)
              ? 1
              : 2,
        });
        console.log(groupId);

        //then get private group settings (group join code etc...)
        await pFirestore
          .collection("platforms")
          .doc(this.context.platform)
          .collection("privateSettings")
          .doc(groupId)
          .get()
          .then((pgs) => {
            console.log(pgs.exists);
            if (pgs.exists) {
              console.log(pgs.data());
              this.setState({ privateGroupSettings: pgs.data() });
            }
          })
          .catch((e) => console.log(e));
      })
      .catch((e) => {
        //if the group NO Longer exists
        this.setState({ isJoined: false });
      });
  };

  //queries all groups and sees if it is an admin, does NOT see if admin for whole platform, see the
  accessPrivileges = () => {
    // pFirestore
    //   .collection("platforms")
    //   .doc(this.context.platform)
    //   .collection("groups")
    //   .where("admins", "array-contains", pAuth.currentUser.uid)
    //   .get()
    //   .then((groups) => {
    //     var arr = [];
    //     groups.forEach((g) => {
    //       arr.push({ ...g.data(), id: g.id });
    //     });
    //     this.setState({ adminGroups: arr });
    //   });
  };

  //gets all current events
  //call this first time AND also EVERY pagination.
  getAllEvents = async (isRefresh) => {
    var nowTime = fbTimestamp.fromDate(new Date());
    //first get the current events
    var allEvents;
    var query = pFirestore
      .collection("platforms")
      .doc(this.context.platform)
      .collection("events")
      .where("endTime", ">=", nowTime)
      .orderBy("endTime", "asc");
    if (!this.state.lastDocAllEvents) return;
    if (this.state.lastDocAllEvents === -1 || isRefresh) {
      allEvents = await query.limit(this.state.limit).get();
    } else {
      allEvents = await query
        .startAfter(this.state.lastDocAllEvents)
        .limit(this.state.limit)
        .get();
    }
    this.setState((prevState) => {
      var arr = isRefresh ? [] : [...prevState.allEvents];
      allEvents.docs.forEach((e) => {
        var newData = { ...e.data() };
        newData.startTime = newData.startTime.toDate();
        newData.endTime = newData.endTime.toDate();
        arr.push({ ...newData, id: e.id });
      });
      return {
        allEvents: arr,
        lastDocAllEvents: allEvents.docs[allEvents.docs.length - 1],
      };
    });
  };

  getPastEvents = async (isRefresh) => {
    var nowTime = fbTimestamp.fromDate(new Date());
    //first get the current events
    var allEvents;
    var query = pFirestore
      .collection("platforms")
      .doc(this.context.platform)
      .collection("events")
      .where("endTime", "<", nowTime)
      .orderBy("endTime", "desc");
    if (!this.state.lastDocPastEvents) return;
    if (this.state.lastDocPastEvents === -1 || isRefresh) {
      allEvents = await query.limit(this.state.limit).get();
    } else {
      allEvents = await query
        .startAfter(this.state.lastDocPastEvents)
        .limit(this.state.limit)
        .get();
    }
    this.setState((prevState) => {
      var arr = isRefresh ? [] : [...prevState.pastEvents];
      allEvents.docs.forEach((e) => {
        var newData = { ...e.data() };

        newData.startTime = newData.startTime.toDate();
        newData.endTime = newData.endTime.toDate();
        arr.push({ ...newData, id: e.id });
      });
      return {
        pastEvents: arr,
        lastDocPastEvents: allEvents.docs[allEvents.docs.length - 1],
      };
    });
  };

  //get from the actual user records of events (including what they got right or wrong), NOT from the platform level "events" collection.
  getCompletedEvents = async (isRefresh) => {
    var groupId = this.state.groupData.id || "individual";

    var query = pFirestore
      .collection("platforms")
      .doc(this.context.platform)
      .collection("users")
      .doc(pAuth.currentUser.uid)
      .collection(groupId)
      .orderBy("timeSubmitted", "desc");
    var eventsList;
    if (!this.state.lastDocCompletedEvents) {
      return;
    }
    if (this.state.lastDocCompletedEvents === -1 || isRefresh) {
      eventsList = await query.limit(this.state.limit).get();
    } else {
      eventsList = await query
        .startAfter(this.state.lastDocCompletedEvents)
        .limit(this.state.limit)
        .get();
    }
    this.setState((prevState) => {
      var arr = isRefresh ? [] : [...prevState.completedEvents];

      eventsList.docs.forEach((e) => {
        var newObj = { ...e.data() };
        newObj.timeSubmitted = e.data().timeSubmitted.toDate();
        arr.push({ ...newObj, id: e.id });
      });

      return {
        completedEvents: [...arr],
        lastDocCompletedEvents: eventsList.docs[eventsList.docs.length - 1],
      };
    });
  };

  //actually just refreshing current events
  refreshAllEvents = async () => {
    this.setState({ lastDocAllEvents: -1 });
    await this.getAllEvents(true);
  };

  refreshPastEvents = async () => {
    this.setState({ lastDocPastEvents: -1 });
    await this.getPastEvents(true);
  };

  refreshCompletedEvents = async () => {
    this.setState({ lastDocCompletedEvents: -1 });
    await this.getCompletedEvents(true);
  };

  unjoin = () => {
    this.setState({ isUnjoinLoading: true });
    var unjoinGroup = pFunctions.httpsCallable("unjoinGroup");
    unjoinGroup({ platformId: this.context.platform })
      .then(() => {
        this.setState({
          isUnjoinLoading: false,
          isJoined: false,
          groupData: {},
          isGroupNotExist: false,
        });
      })
      .catch((e) =>
        this.setState({ isUnjoinError: true, isUnjoinLoading: false })
      );
  };

  render() {
    if (this.state.isLoadingPlatform)
      return (
        <div>
          <Loading isFullCenter={true} />
        </div>
      );
    var accessLevel = 0;
    if (this.state.isJoined) accessLevel += 2;
    if (this.state.isGroupAdmin) accessLevel++;
    if (this.state.isAdmin) accessLevel++;
    var mainComponent;
    switch (this.state.menuOption) {
      case 0:
        mainComponent = (
          <PlatformAdmin
            platformSettings={this.state.platformSettings}
            privateSettings={this.state.privateSettings}
            dbMapping={this.state.dbMapping}
          />
        );
        break;
      case 1:
        mainComponent = (
          <GroupAdmin
            groupData={this.state.groupData}
            getGroupAdminData={this.getGroupAdminData}
            recentActivity={this.state.recentActivity}
            allUsers={this.state.allGroupUsers}
            lastViewed={this.state.lastViewed}
            setLastViewed={(v) => this.setState({ lastViewed: v })}
            privateGroupSettings={this.state.privateGroupSettings}
            groupName={this.state.platformSettings.groupName}
            limit={this.state.limit}
            getLastViewed={this.getLastViewed}
          />
        );
        break;
      case 2:
        mainComponent = (
          <EventsList
            isAdmin={this.state.isAdmin}
            dbMapping={this.state.dbMapping}
            userData={this.state.userData}
            getAllEvents={this.getAllEvents}
            getPastEvents={this.getPastEvents}
            allEvents={this.state.allEvents}
            pastEvents={this.state.pastEvents}
            refreshAllEvents={this.refreshAllEvents}
            refreshPastEvents={this.refreshPastEvents}
          />
        );
        break;
      case 3:
        mainComponent = (
          <MyStats
            userData={this.state.userData}
            groupName={this.state.platformSettings.groupName}
            completedEvents={this.state.completedEvents}
            getCompletedEvents={this.getCompletedEvents}
            refreshCompletedEvents={this.refreshCompletedEvents}
          />
        );
        break;
      default:
        mainComponent = (
          <MyStats
            userData={this.state.userData}
            groupName={this.state.platformSettings.groupName}
            completedEvents={this.state.completedEvents}
            getCompletedEvents={this.getCompletedEvents}
            refreshCompletedEvents={this.refreshCompletedEvents}
          />
        );
    }
    if (this.state.doesNotExist)
      return (
        <div className="grayed-out-background">
          <div className="popup nsp">
            This Platform No Longer Exists
            <button
              className="sb"
              onClick={() => this.context.setPlatform(null)}
            >
              Explore New Platforms
            </button>
          </div>
        </div>
      );
    if (this.state.isGroupNotExist) {
      return (
        <div className="grayed-out-background">
          <div className="popup nsp">
            This {this.state.platformSettings.groupName} No Longer Exists
            {this.state.isUnjoinLoading ? (
              <Loading />
            ) : (
              <button className="sb" onClick={this.unjoin}>
                Join Another {this.state.platformSettings.groupName}
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div id="platform-container">
        {this.state.isUnjoinLoading && (
          <div className="grayed-out-background">
            <div className="popup nsp">
              <Loading />
            </div>
          </div>
        )}
        {this.state.isUnjoinError && (
          <div className="grayed-out-background">
            <div className="popup nsp">
              <h5>Error Unjoining</h5>
              <button
                className="cancel-button"
                onClick={() => this.setState({ isUnjoinError: false })}
              >
                Close
              </button>
            </div>
          </div>
        )}

        {this.state.isJoined ? (
          <div id="joined-platform">
            <div
              id="group-header"
              style={{
                background: `linear-gradient( rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5) ), url(${this.state.platformSettings.bannerURL}) no-repeat center`,
                backgroundSize: "cover",
              }}
            >
              {/* {this.state.platformSettings.bannerURL && (
                <img src={this.state.platformSettings.bannerURL}></img>
              )} */}
              <h2 id="group-name">
                {this.state.groupData.name || "Individual Join"}
              </h2>
              <p id="group-description">
                {this.state.groupData.description ||
                  `Joined this platform without joining a ${this.state.platformSettings.groupName}`}
              </p>
              <ul id="group-admins">
                {this.state.groupData.admins &&
                  this.state.groupData.admins.map((a) => (
                    <li>
                      <img className="person-icon" src={personIcon} />
                      {this.context.usersMapping[a]}
                    </li>
                  ))}
              </ul>
              <button className="sb unjoin-button" onClick={this.unjoin}>
                Switch {this.state.groupData && this.state.groupData.groupName}
              </button>
            </div>

            <div
              className="switch-menu"
              id="platform-switch-menu"
              style={{ gridTemplateColumns: `repeat(${accessLevel},1fr)` }}
            >
              {this.state.isAdmin && (
                <button
                  onClick={() => {
                    this.setState({ menuOption: 0 });
                  }}
                  className={this.state.menuOption == 0 ? "selected" : ""}
                >
                  <div>Platform Admin</div>
                  <span></span>
                </button>
              )}
              {this.state.isGroupAdmin > 0 && (
                <button
                  onClick={() => {
                    this.setState({ menuOption: 1 });
                  }}
                  className={this.state.menuOption == 1 ? "selected" : ""}
                >
                  <div>{this.state.platformSettings.groupName} Admin</div>
                  <span></span>
                </button>
              )}
              <button
                onClick={() => {
                  this.setState({ menuOption: 2 });
                }}
                className={this.state.menuOption == 2 ? "selected" : ""}
              >
                <div>Events</div>
                <span></span>
              </button>
              <button
                onClick={() => {
                  this.setState({ menuOption: 3 });
                }}
                className={this.state.menuOption == 3 ? "selected" : ""}
              >
                <div>My Stats</div>
                <span></span>
              </button>
            </div>
            <div id="platform-main">{mainComponent}</div>
          </div>
        ) : (
          <div>
            <LobbyPlatform
              requireGroup={this.state.platformSettings.requireGroup}
              publicCreateGroup={this.state.platformSettings.publicCreateGroup}
              groupOptions={this.state.platformSettings.groupOptions}
              groupOptionsOn={this.state.platformSettings.groupOptionsOn}
              groupName={this.state.platformSettings.groupName}
              setMenuOption={(a) => this.setState({ menuOption: a })}
              checkJoinedStatus={this.isJoined}
              userData={this.state.userData}
              privateSettings={this.state.privateSettings}
              publicJoin={this.state.platformSettings.publicJoin}
              platformSettings={this.state.platformSettings}
            />
          </div>
        )}
      </div>
    );
  }
}
Platform.contextType = PContext;

export default Platform;

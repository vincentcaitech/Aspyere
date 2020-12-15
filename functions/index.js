const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { user } = require("firebase-functions/lib/providers/auth");

admin.initializeApp();

const db = admin.firestore();

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
exports.helloWorld = functions.https.onRequest(async (request, response) => {
  functions.logger.info("Hello logs!", { structuredData: true });
  await db
    .collection("users")
    .doc("jWC5XTCceKeU9fiCMdfMqq7YbCH3")
    .update({
      platform: "platformId",
      recentPlatforms: admin.firestore.FieldValue.arrayUnion({
        platform: "platformId",
        time: admin.firestore.FieldValue.serverTimestamp(),
      }),
    });
  response.send("Hello from Firebase!");
});

//data: Object {platformId: , tryAccessCode:  }
// exports.joinPlatform = functions.https.onCall((data,context)=>{
//     db.collection("platforms").doc(data.plaformId).get().then((doc)=>{
//         doc.data()
//     })
// })

exports.onNewUser = functions.auth.user().onCreate((user) => {
  db.collection("users")
    .doc(user.uid)
    .set({
      dateCreated: admin.firestore.FieldValue.serverTimestamp(),
      displayName: user.displayName || user.email.split("@")[0],
      uid: user.uid,
      email: user.email,
      imageURL: user.photoURL,
      platform: null,
      allPlatforms: [],
    });
  db.collection("settings")
    .doc("usersMapping")
    .update({ [user.uid]: { displayName: user.displayName || user.email } });
});

//data: {name: , description: }
exports.createPlatform = functions.https.onCall(async (data, context) => {
  if (!context.auth.uid) {
    return false;
  }
  try {
    var platformDoc = await db.collection("platforms").add({
      name: data.name,
      description: data.description,
      admins: [context.auth.uid],
      databases: [],
      groupName: "Group",
      groupOptions: [],
      groupOptionsOn: false,
      publicCreateGroup: false,
      publicJoin: false,
      requireGroup: true,
      views: 1,
    });

    await db
      .collection("platforms")
      .doc(platformDoc.id)
      .collection("privateSettings")
      .doc("privateSettings")
      .set({
        joinCode: (Math.random() * new Date().getTime())
          .toString(36)
          .substr(0, 6),
        groupCreateCode: (Math.random() * new Date().getTime())
          .toString(36)
          .substr(0, 6),
      });
    await userPlatformRecord(context.auth.uid, platformDoc.id);
    return true;
  } catch (e) {
    return false;
  }
});
//returns true if success, false if error

//ONLY WHEN EXPLICITLY SWITCHING TO A PLATFORM, so therefore must check if it is already in the user's "allPlatforms" array. When you join a platform the first time (through joining a group or individually), it automatically sets the user records.
//data: {platformId: } (that's it)
exports.joinPlatform = functions.https.onCall(async (data, context) => {
  try {
    var rootUserData = await db.collection("users").doc(context.auth.uid).get();
    if (
      rootUserData.data().allPlatforms &&
      rootUserData.data().allPlatforms.includes(data.platformId)
    ) {
      await userPlatformRecord(context.auth.uid, data.platformId);
      return true;
    } else {
      return false;
    }
  } catch (e) {
    return false;
  }
});
//return true if success, false if error

//data: {name: , description: , displayName: ,}
exports.createDB = functions.https.onCall(async (data, context) => {
  try {
    //first create the database with given settings
    var res = await db.collection("databases").add({
      members: [],
      admins: [context.auth.uid],
      isViewable: false,
      name: data.name,
      description: data.description,
      creator: data.displayName,
    });
    //then create a private settings doc in dbPrivateSettings, and set a random memberCode
    await db.collection("dbPrivateSettings").doc(res.id).set({
      memberCode: generateRandomCode(),
    });
    return res.id;
  } catch (e) {
    return null;
  }
});
//returns the new DB id if success, return null if error.

function generateRandomCode() {
  return (new Date().getTime() * Math.random()).toString(36).replace(".", "");
}

//data: {dbId: , userId: }
exports.promoteDBUser = functions.https.onCall(async (data, context) => {
  try {
    await db
      .collection("databases")
      .doc(data.dbId)
      .update({
        admins: admin.firestore.FieldValue.arrayUnion(data.userId),
        members: admin.firestore.FieldValue.arrayRemove(data.userId),
      });
    return true;
  } catch (e) {
    return false;
  }
});
//returns true if success, false if error.

//data: {dbId: , userId: }
exports.deleteDBUser = functions.https.onCall(async (data, context) => {
  try {
    await db
      .collection("databases")
      .doc(data.dbId)
      .update({
        members: admin.firestore.FieldValue.arrayRemove(data.userId),
      });
    return false;
  } catch (e) {
    return true;
  }
});
//returns true if success, false if error

//only for the properties name, description, and isViewable. set to null if you don't want to update this.
//data: {dbId: , isViewable: , name:, description: }
exports.updateDBSettings = functions.https.onCall(async (data, context) => {
  var updates = {};
  //so it will still evaluate if isViewable is "false"
  if (data.isViewable != null) {
    updates.isViewable = data.isViewable;
  }
  if (data.name) {
    updates.name = data.name;
  }
  if (data.description) {
    updates.description = data.description;
  }
  await db.collection("databases").doc(data.dbId).update(updates);
  return true;
});
//return true if success, false if error

//data: {dbId: , memberCodeTry: }
exports.tryDBMemberCode = functions.https.onCall(async (data, context) => {
  try {
    var privateSettings = await db
      .collection("dbPrivateSettings")
      .doc(data.dbId)
      .get();
    if (privateSettings.data().memberCode == data.memberCodeTry) {
      await db
        .collection("databases")
        .doc(data.dbId)
        .update({
          members: admin.firestore.FieldValue.arrayUnion(context.auth.uid),
        });
      return true;
    } else {
      return false;
    }
  } catch (e) {
    return false;
  }
});
//true is has access, false if access error.

//data {platformId: , tryGroupCreateCode: ,groupSettings: {}}
//groupSettings MUST include a name and a description.
exports.createGroup = functions.https.onCall(async (data, context) => {
  if (!data.groupSettings) return "noGroupSettings";

  try {
    if (data.groupSettings.admins.length < 1)
      data.groupSettings.admins.push(context.auth.uid);
    var platformData = await db
      .collection("platforms")
      .doc(data.platformId)
      .get();
    if (platformData.data().publicCreateGroup) {
      var res = await createGroupInDB(
        data.platformId,
        data.groupSettings,
        context.auth.uid
      );
      return res;
    } else {
      var privateSettings = await db
        .collection("platforms")
        .doc(data.platformId)
        .collection("privateSettings")
        .doc("privateSettings")
        .get();
      if (privateSettings.data().groupCreateCode === data.tryGroupCreateCode) {
        var res = await createGroupInDB(
          data.platformId,
          data.groupSettings,
          context.auth.uid
        );
        return res;
      } else {
        return false;
      }
    }
  } catch (e) {
    console.log(e);
    return false;
  }
});
//returns true if success, false if error.

//data {platformId: , groupId: }
exports.deleteGroup = functions.https.onCall(async (data, context) => {
  try {
    //Step 1: check if admin (get the group doc along the way)
    var groupDoc = await db
      .collection("platforms")
      .doc(data.platformId)
      .collection("groups")
      .doc(data.groupId)
      .get();
    if (!groupDoc.data().admins.includes(context.auth.uid)) {
      return { isError: true };
    }

    //Step 2: delete the group doc and the group's privateSettings doc.
    await groupDoc.ref.delete();
    await db
      .collection("platforms")
      .doc(data.platformId)
      .collection("privateSettings")
      .doc(data.groupId)
      .delete();
    //Step 3: delete all the records with this group. Get all collections with this groupId, and then delete them all, regardless from what user.
    var batch = db.batch();
    var allGroupCollections = await db.collectionGroup(data.groupId).get();
    allGroupCollections.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    return { isError: false };
  } catch (e) {
    return { isError: true };
  }
});
//returns {isError: }

async function createGroupInDB(platformId, groupSettings, userId) {
  try {
    var randomCode = Math.random() * new Date().getTime();
    randomCode = randomCode.toString(36).substr(0, 6);
    var newGroup = await db
      .collection("platforms")
      .doc(platformId)
      .collection("groups")
      .add({ ...groupSettings });
    await db
      .collection("platforms")
      .doc(platformId)
      .collection("privateSettings")
      .doc(newGroup.id)
      .set({ joinCode: randomCode });
    await joinGroupInDB(userId, platformId, newGroup.id, false);
    return true;
  } catch (e) {
    console.log(e);
    return false;
  }
}

//data: {dbId: , memberCode: }
exports.updateMemberCode = functions.https.onCall(async (data, context) => {
  try {
    await db.collection("dbPrivateSettings").doc(data.dbId).update({
      memberCode: data.memberCode,
    });
    return true;
  } catch (e) {
    return false;
  }
});
//returns true if success, false if error.

//data: {platformId: , tryJoinCode: }
exports.joinIndividually = functions.https.onCall(async (data, context) => {
  try {
    var platformDoc = await db
      .collection("platforms")
      .doc(data.platformId)
      .get();
    if (!platformDoc.exists) return { isError: true, errorType: 2 };
    else {
      if (platformDoc.data().publicJoin) {
        await joinGroupInDB(
          context.auth.uid,
          data.platformId,
          "individual",
          false
        );
        return { isError: false };
      } else {
        var userData = await db
          .collection("platforms")
          .doc(data.platformId)
          .collection("users")
          .doc(context.auth.uid)
          .get();
        if (
          userData.exists &&
          userData.data().joinedGroups &&
          userData.data().joinedGroups.includes("individual")
        ) {
          await joinGroupInDB(
            context.auth.uid,
            data.platformId,
            "individual",
            false
          );
          return { isError: false };
        }

        var privateSettings = await platformDoc.ref
          .collection("privateSettings")
          .doc("privateSettings")
          .get();
        if (privateSettings.data().joinCode == data.tryJoinCode) {
          await joinGroupInDB(
            context.auth.uid,
            data.platformId,
            "individual",
            false
          );
          return { isError: false };
        } else {
          return { isError: true, errorType: 1 };
        }
      }
    }
  } catch (e) {
    return { isError: true, errorType: 3 };
  }
});
//returns {isError: ,errorType: 1- joinCode is wrong, 2- platform doesn't exist 3- server error}

//data: {platformId: }
//just sets the group to null
exports.unjoinGroup = functions.https.onCall(async (data, context) => {
  await db
    .collection("platforms")
    .doc(data.platformId)
    .collection("users")
    .doc(context.auth.uid)
    .update({ currentGroup: null });
});

//data: Object {platformId: , groupId: , accessCodeTry}
exports.joinGroup = functions.https.onCall(async (data, context) => {
  var groupData = await db
    .collection("platforms")
    .doc(data.platformId)
    .collection("groups")
    .doc(data.groupId)
    .get();
  if (
    groupData.data().isPublic ||
    groupData.data().admins.includes(context.auth.uid)
  ) {
    await joinGroupInDB(context.auth.uid, data.platformId, data.groupId, false);
    return true;
  } else {
    var userData = await db
      .collection("platforms")
      .doc(data.platformId)
      .collection("users")
      .doc(context.auth.uid)
      .get();
    if (
      userData.exists &&
      userData.data().joinedGroups &&
      userData.data().joinedGroups.includes(data.groupId)
    ) {
      await joinGroupInDB(
        context.auth.uid,
        data.platformId,
        data.groupId,
        true
      );
      return true;
    }

    var privateSettings = await db
      .collection("platforms")
      .doc(data.platformId)
      .collection("privateSettings")
      .doc(data.groupId)
      .get();
    if (privateSettings.data().joinCode == data.accessCodeTry) {
      await joinGroupInDB(
        context.auth.uid,
        data.platformId,
        data.groupId,
        false
      );
      return true;
    } else {
      return false;
    }
  }
});

//to update the last viewed time when a user views group admin. Updates the fieldName with a new serverTimestamp()
//data: Object {platformId: , fieldName: }
exports.updateUserViewTime = functions.https.onCall(async (data, context) => {
  await db
    .collection("platforms")
    .doc(data.platformId)
    .collection("users")
    .doc(context.auth.uid)
    .update({ [data.fieldName]: admin.firestore.FieldValue.serverTimestamp() });
});

//creates the records, as well as switches the group
async function joinGroupInDB(
  userId,
  platformId,
  groupId,
  alreadyCheckedExists
) {
  await userPlatformRecord(userId, platformId);
  if (alreadyCheckedExists) {
    await db
      .collection("platforms")
      .doc(platformId)
      .collection("users")
      .doc(userId)
      .update({
        currentGroup: groupId,
        joinedGroups: admin.firestore.FieldValue.arrayUnion(groupId),
      });
    return;
  }

  var doc = await db
    .collection("platforms")
    .doc(platformId)
    .collection("users")
    .doc(userId)
    .get();
  if (!doc.exists) {
    var userDoc = await db
      .collection("platforms")
      .doc(platformId)
      .collection("users")
      .doc(userId)
      .set({
        currentGroup: groupId,
        completedEvents: [],
        joinedGroups: [groupId], //create this. These are the groups already joined at least once before
      });
  } else {
    await db
      .collection("platforms")
      .doc(platformId)
      .collection("users")
      .doc(userId)
      .update({
        currentGroup: groupId,
        joinedGroups: admin.firestore.FieldValue.arrayUnion(groupId),
      });
  }
  //this should be for every new group joined.
  var userDataRecords = await doc.ref.collection(groupId).doc("userData").get();
  if (!userDataRecords.exists) {
    userDataRecords.ref.set(
      {
        totalPoints: 0,
        startTime: admin.firestore.FieldValue.serverTimestamp(),
        totalPossiblePoints: 0,
        totalEvents: 0,
      },
      { merge: true }
    );
  }
}

//Switches the User's platform in the "users" collection
//also records the platform joined in the users recent platforms for quick access
async function userPlatformRecord(userId, platformId) {
  await db
    .collection("users")
    .doc(userId)
    .update({
      platform: platformId,
      allPlatforms: admin.firestore.FieldValue.arrayUnion(platformId),
    });
}

//data: {platformId: , groupId:, updates: }
exports.updateGroupSettings = functions.https.onCall(async (data, context) => {
  var groupDoc = await db
    .collection("platforms")
    .doc(data.platformId)
    .collection("groups")
    .doc(data.groupId)
    .get();
  if (!groupDoc.exists) return { isError: true, errorType: 1 };
  if (!groupDoc.data().admins.includes(context.auth.uid))
    return { isError: true, errorType: 2 };
  await groupDoc.ref.update({
    ...data.updates,
  });
  return { isError: false };
});
//return {isError: , errorType: 1-group not found 2-not an admin,}

//data: {platformId: ,groupId:, privateSettings: {}}
exports.updatePrivateGroupSettings = functions.https.onCall(
  async (data, context) => {
    var groupDoc = await db
      .collection("platforms")
      .doc(data.platformId)
      .collection("groups")
      .doc(data.groupId)
      .get();
    if (!groupDoc.exists) return { isError: true, errorType: 1 };
    if (!groupDoc.data().admins.includes(context.auth.uid))
      return { isError: true, errorType: 2 };
    await db
      .collection("platforms")
      .doc(data.platformId)
      .collection("privateSettings")
      .doc(data.groupId)
      .set({ ...data.privateSettings }, { merge: true });
    return { isError: false };
  }
);
//returns {isError: , errotType: 1-group doesn't exist, 2- not admin}

//data: {platformId: ,groupId: , userToPromote: }
exports.promoteGroupUser = functions.https.onCall(async (data, context) => {
  var groupDoc = await db
    .collection("platforms")
    .doc(data.platformId)
    .collection("groups")
    .doc(data.groupId)
    .get();
  if (!groupDoc.exists) return { isError: true, errorType: 1 };
  if (!groupDoc.data().admins.includes(context.auth.uid))
    return { isError: true, errorType: 2 };
  await groupDoc.ref.update({
    admins: admin.firestore.FieldValue.arrayUnion(data.userToPromote),
  });
  return { isError: false };
});
//returns {isError: , errotType: 1-group doesn't exist, 2- not admin}

//data: Object {platformId: , updates: Object(), privateSettingsUpdates: Object() or null if none}
exports.updatePlatformSettings = functions.https.onCall(
  async (data, context) => {
    console.log(data, context.auth.uid);
    await db
      .collection("platforms")
      .doc(data.platformId)
      .get()
      .then((doc) => {
        console.log(doc.data());
        console.log(doc.data().admins);
        console.log(context.auth.uid, data.platformId, data.updates);
        if (doc.data().admins && doc.data().admins.includes(context.auth.uid)) {
          //Update public settings if there are settings to update
          if (data.updates && Object.keys(data.updates).length > 0) {
            db.collection("platforms")
              .doc(data.platformId)
              .update(data.updates)
              .catch((e) => console.log(e));
          }

          //Update private settings only if you need to.
          if (
            data.privateSettingsUpdates &&
            Object.keys(data.privateSettingsUpdates).length > 0
          ) {
            db.collection("platforms")
              .doc(data.platformId)
              .collection("privateSettings")
              .doc("privateSettings")
              .update(data.privateSettingsUpdates)
              .catch((e) => console.log(e));
          }
        } else {
          console.log("not an admin");
        }
      });
  }
);

//data: Object {platformId: , dbId: }
exports.connectDatabaseToPlatform = functions.https.onCall(
  async (data, context) => {
    try {
      var isAdmin = await checkIfAdmin(data.platformId, context.auth.uid);
      if (!isAdmin) return { isError: true, errorType: 2 };
      var databaseDoc = await db.collection("databases").doc(data.dbId).get();
      if (!databaseDoc.exists) return { isError: true, errorType: 1 };
      if (!databaseDoc.data().admins.includes(context.auth.uid))
        return { isError: true, errorType: 4 };
      await db
        .collection("platforms")
        .doc(data.platformId)
        .update({
          databases: admin.firestore.FieldValue.arrayUnion(data.dbId),
        });
      return { isError: false };
    } catch (e) {
      return { isError: true, errorType: 3 };
    }
  }
);
//returns {isError: , errorType: 1-not valid dbId, 2- not a platform admin, 3 - server error, 4- not a database admin}

//data: Object {platformId: , dbId: }
exports.disconnectDatabaseToPlatform = functions.https.onCall(
  async (data, context) => {
    try {
      var isAdmin = await checkIfAdmin(data.platformId, context.auth.uid);
      if (isAdmin) {
        await db
          .collection("platforms")
          .doc(data.platformId)
          .update({
            databases: admin.firestore.FieldValue.arrayRemove(data.dbId),
          });
        return { isError: false };
      } else {
        return { isError: true, errorType: 2 };
      }
    } catch (e) {
      return { isError: true, errorType: 3 };
    }
  }
);
//returns {isError: ,errorType: 2- not an admin, 3- server error}

//data: Object {platformId: , eventId: , updates: Object()}
//NOTE: Dates in updates.startTime and updates.endTime are just a number of milliseconds
exports.updateEvent = functions.https.onCall(async (data, context) => {
  var isAdmin = await checkIfAdmin(data.platformId, context.auth.uid);
  if (isAdmin) {
    var updates = { ...data.updates };
    updates.startTime = admin.firestore.Timestamp.fromDate(
      new Date(Number(updates.startTime))
    );
    // console.log(updates);
    updates.endTime = admin.firestore.Timestamp.fromDate(
      new Date(Number(updates.endTime))
    );
    // console.log(updates);
    if (data.eventId) {
      //edit an existing event
      await db
        .collection("platforms")
        .doc(data.platformId)
        .collection("events")
        .doc(data.eventId)
        .update(updates);
    } else {
      //create a new event
      var res = await db
        .collection("platforms")
        .doc(data.platformId)
        .collection("events")
        .add(updates);
      await db
        .collection("platforms")
        .doc(data.platformId)
        .collection("eventRecords")
        .doc(res.id)
        .set({
          admin: context.auth.uid,
        });
    }
  }
});

async function checkIfAdmin(platformId, userId) {
  var platformData = await db.collection("platforms").doc(platformId).get();
  return Boolean(
    platformData.data().admins && platformData.data().admins.includes(userId)
  );
}

//data: {platformId: , eventId: }
exports.getLiveQuestions = functions.https.onCall(async (data, context) => {
  //Step 1: first check if the user is logged in, and get the event doc (for name and description, also checking if platform and event ids are valid)
  if (!context.auth.uid) return { isError: true, errorType: 6 };
  var doc = await db
    .collection("platforms")
    .doc(data.platformId)
    .collection("events")
    .doc(data.eventId)
    .get();
  if (!doc.exists) return { isError: true, errorType: 2 }; //if invalid event or platform Id (so the doc is not found), return an error.

  //Steps 2 and 2.1: check if user has already SUBMITTED for this event, either for this group (return feedback) or in a different group (return error)
  //Step 2.3: if not yet submitted, check if within time frame to open.
  //Step 2.4: if not sumbitted and within correct time frame, check if user has OPENED this event (but not yet submitted), if so, return the eventRecords.
  //Steps 2 & beyond: if user has neither submitted nor opened (is opening for first time), generate the questions and save them to userRecords so user can retrieve them the next time they open them.

  //NOTE: MUST do this before 2.1, because step 2.1 will return an error if it is in eventsCompleted, even if it is completed in this group. Therefore, first get the feedback, then if no feedback and it is completed, then it was completed in another group
  //Step 2: Return feedback if any: get the user records, to check if the user has not joined this platform, or for double-doing, and get the group id.
  var userRecords = await getUserRecords(
    data.platformId,
    context.auth.uid,
    data.eventId
  );
  if (userRecords.isNotFound)
    return { isError: true, errorType: 5, userId: context.auth.uid };
  if (!userRecords.isFirstTime)
    return {
      isError: false,
      isFeedback: true,
      finalQuestions: userRecords.records.questions,
      eventName: doc.data().name,
      eventDescription: doc.data().description,
      endTime: endTime, //in milliseconds
    };

  //Step 2.1: check if this event has already been completed in the user's doc "completedEvents" array. If so, it has been done in another group and return an error
  var userDoc = await db
    .collection("platforms")
    .doc(data.platformId)
    .collection("users")
    .doc(context.auth.uid)
    .get();

  if (
    userDoc.exists &&
    userDoc.data().completedEvents &&
    userDoc.data().completedEvents.includes(data.eventId)
  ) {
    return { isError: true, errorType: 7 };
  }

  //Now we checked if it has been completed, now it is either in progress or not yet started.

  //Step 2.3: check if it is within the time frame.
  var endTime = doc.data().endTime.toDate().getTime();
  if (new Date().getTime() < doc.data().startTime.toDate().getTime())
    return { isError: true, errorType: 3 };
  if (new Date().getTime() > endTime) return { isError: true, errorType: 4 };

  //Step 2.4: Before generating new questions, check if there are already records of this user in this event in this platform, the questions already being generated.
  //Must do this AFTER the above steps, to make sure you don't return questions when the event is over, hasn't started, or already submitted
  var eventRecord = await db
    .collection("platforms")
    .doc(data.platformId)
    .collection("eventRecords")
    .doc(data.eventId)
    .collection("usersEventRecords")
    .doc(context.auth.uid)
    .get();
  if (
    eventRecord.exists &&
    eventRecord.data()["questions"] &&
    eventRecord.data()["questions"].length > 0
  ) {
    var preStoredQuestions = [];
    eventRecord.data()["questions"].forEach((q) => {
      delete q.answers;
      preStoredQuestions.push(q);
    });
    return {
      isError: false,
      finalQuestions: preStoredQuestions,
      isStored: true,
      eventName: doc.data().name,
      eventDescription: doc.data().description,
      endTime: endTime,
    };
  }

  //Now that all the checks have been completed, we know it is not been completed or started. Now start preparing to generate new questions, starting at Step 2.

  //Step 3: Get the difficulty:
  //if no group id, and working individually, auto set it to 100.
  var difficulty = 0;
  if (!userRecords.groupId) difficulty = 100;
  else {
    //else use the group ID to get the group's difficulty;
    var groupDoc = await db
      .collection("platforms")
      .doc(data.platformId)
      .collection("events")
      .doc(data.eventId)
      .collection("groups")
      .doc(userRecords.groupId)
      .get();
    if (groupDoc.exists) difficulty = Number(groupDoc.data().difficulty);
  }

  //Step 4: Now, with all the data fetched, get the questions data, and generate questions
  var questions = doc.data().questions;
  var questionsAsync = questions.map((q) =>
    generateQuestionFromDB(q, context.auth.uid, data.platformId, difficulty)
  ); //See this method (generateQuestionFromDB) for further Steps 5-6.
  var finalQuestions = [];
  var finalEventRecords = [];
  for await (finalQuestion of questionsAsync) {
    //Step 7: fter each question is generated, push it onto the finalQuestions and finalEventRecords array.
    if (finalQuestion) {
      var questionToPush = { ...finalQuestion };
      questionToPush.isError = false;
      //get rid of extraneous info
      delete questionToPush.lastEditor;
      delete questionToPush.creator;
      //push onto finalEventRecords, with the answers
      finalEventRecords.push({ ...questionToPush });
      //then delete the answers and push onto finalQuestions
      delete questionToPush.answers;
      finalQuestions.push({ ...questionToPush });
    } else {
      //sometimes, there's an error with generating questions (no connected db, no questions meet criteria, etc). the above method will return null, and return an object with isErro: true;
      finalQuestions.push({
        isError: true,
      });
      finalEventRecords.push({ isError: true });
    }
  }
  //Step 8: Put into "eventRecords", optimization technique to quickly get the SAME questions next time, AND to check answers when finished, without having to worry about client sending in fake data.
  await db
    .collection("platforms")
    .doc(data.platformId)
    .collection("eventRecords")
    .doc(data.eventId)
    .collection("usersEventRecords")
    .doc(context.auth.uid)
    .set({ questions: finalEventRecords }, { merge: true });
  //Step 9: return the questions to the client.
  return {
    isError: false,
    finalQuestions: finalQuestions,
    eventName: doc.data().name,
    eventDescription: doc.data().description,
    endTime: endTime,
  };
});
/*Returns:
An object with properties:
-isError: true if error, false otherwise
-isFeedback, true if has records, returns the records, false otherwise
  -records: Object of the records for this specific event.
-errorType: only if error, 1 for already done this question, 2 for cannot find the event, 3 for not started yet, 4 for already finished, 5 for user not joined platform, 6 for auth error, 7 for completed already in a different group (not showing records, because no records for this group).
-final questions: the data object from each of the questions generated.
-eventName
-eventDescription
-endTime: this is in Milliseconds (using .getTime() for a Date)
*/

//check to prevent double doing the rounds, and get the groupId
//true: OK, is first time; false: already did this event;
async function getUserRecords(platformId, userId, eventId) {
  //first get the group id from the user doc.
  var userData = await db
    .collection("platforms")
    .doc(platformId)
    .collection("users")
    .doc(userId)
    .get();
  if (!userData.exists) return { isNotFound: true };

  //then get the records, if any.

  var currentGroup = userData.data().currentGroup;
  if (!currentGroup) return { isNotFound: true };
  var records = await db
    .collection("platforms")
    .doc(platformId)
    .collection("users")
    .doc(userId)
    .collection(currentGroup)
    .doc(eventId)
    .get();
  if (!records.exists)
    return { isNotFound: false, isFirstTime: true, groupId: currentGroup };
  return {
    isNotFound: false,
    isFirstTime: false,
    groupId: currentGroup,
    records: records.data(),
  };
}
//returns {isNotFound: , isFirstTime: , groupId: }
//will return isNotFound as true if either there is no document for that user, OR if the currentGroup is null.

async function generateQuestionFromDB(
  question,
  userId,
  platformId,
  difficulty
) {
  //Step 5: Get the database id, generate if random.
  var dbId = question.databaseId;
  if (!dbId) dbId = await getRandomDB(platformId, userId); //here this is if the inputed db is undefined, then get a random DB
  if (question.dbRandomize) dbId = await getRandomDB(platformId, userId);
  if (!dbId) return null; //Here, if it is STILL nonexistent after any db was selected, this means there is no dbs connected to the platform, and thus an error.

  //Step 5.5: Only if there is a specific question ID, get the question and return. If the Question ID is nonexistent, fallback to generating random question.
  if (!question.questionRandomize && question.questionId) {
    var qr = await db
      .collection("databases")
      .doc(dbId)
      .collection("questions")
      .doc(question.questionId)
      .get();
    if (qr.exists)
      return {
        ...qr.data(),
        stage: "questionId",
        points: question.points,
        questionId: question.questionId,
        dbId: dbId,
      }; //COME BACK, make sure you remove the answers from here, or somewhere in the code.
  }

  //Step 6: Get the possible question options
  difficulty = Number(difficulty);
  difficulty += Number(question.difficultyRange);
  var diffLower = difficulty - Math.abs(Number(question.difficultyOffset));
  var diffUpper = difficulty + Math.abs(Number(question.difficultyOffset));
  var questionOptions;
  //Step 6.1: First pass through. Strictly in the range, and containing the tags, if any
  if (question.tags && question.tags.length < 1) {
    //if No tags, query only within range.
    questionOptions = await db
      .collection("databases")
      .doc(dbId)
      .collection("questions")
      .where("difficulty", ">=", diffLower)
      .where("difficulty", "<=", diffUpper)
      .get();
  } else {
    //if there are tags, query with tags. Firestore only allows array-contains-any queries of 10 elements max.
    var tags = question.tags.slice(0, 10);
    questionOptions = await db
      .collection("databases")
      .doc(dbId)
      .collection("questions")
      .where("difficulty", ">=", diffLower)
      .where("difficulty", "<=", diffUpper)
      .where("tags", "array-contains-any", tags)
      .get();
  }
  if (questionOptions.docs.length > 0) {
    return {
      ...questionOptions.docs[
        hashToNumber(userId) % questionOptions.docs.length
      ].data(),
      questionId:
        questionOptions.docs[hashToNumber(userId) % questionOptions.docs.length]
          .id,
      dbId: dbId,
      points: question.points,
      stage: 1,
    };
  } else {
    //Step 6.2: Second pass through, if array is empty. Query without tags, and double the range.
    diffLower -= Math.abs(Number(question.difficultyOffset));
    diffUpper += Math.abs(Number(question.difficultyOffset));
    questionOptions = await db
      .collection("databases")
      .doc(dbId)
      .collection("questions")
      .where("difficulty", ">=", diffLower)
      .where("difficulty", "<=", diffUpper)
      .get();
    //then check again if the array is empty or not
    if (questionOptions.docs.length > 0) {
      return {
        ...questionOptions.docs[
          hashToNumber(userId) % questionOptions.docs.length
        ].data(),
        questionId:
          questionOptions.docs[
            hashToNumber(userId) % questionOptions.docs.length
          ].id,
        dbId: dbId,
        points: question.points,
        stage: 2,
      };
    } else {
      //Step 6.3: Third Pass through, no restrictions, any question in the database is fair game.
      questionOptions = await db
        .collection("databases")
        .doc(dbId)
        .collection("questions")
        .limit(10) //Change this if needed, but limit to 10 for now.
        .get();
      if (questionOptions.docs.length > 0) {
        return {
          ...questionOptions.docs[
            hashToNumber(userId) % questionOptions.docs.length
          ].data(),
          questionId:
            questionOptions.docs[
              hashToNumber(userId) % questionOptions.docs.length
            ].id,
          dbId: dbId,
          points: question.points,
          stage: 3,
        };
      } else {
        //Step 6.4: If nothing in that database, then return null, signalling failure.
        return null;
      }
    }
  }
}

async function getRandomDB(platformId, userId) {
  var platform = await db.collection("platforms").doc(platformId).get();
  var databases = platform.data().databases;
  if (databases.length == 0) return null;
  return databases[hashToNumber(userId) % databases.length];
}

//ALSO randomness here, because questions are being stored in eventRecords.
function hashToNumber(string) {
  var num = 0;
  for (var i = 0; i < string.length; i++) {
    num += String(string).charCodeAt(i);
  }
  return num + Math.round(Math.random() * 100);
}

//data: {platformId: , eventId: }
exports.deleteEvent = functions.https.onCall(async (data, context) => {
  await db
    .collection("platforms")
    .doc(data.platformId)
    .collection("events")
    .doc(data.eventId)
    .delete();
  await db
    .collection("platforms")
    .doc(data.platformId)
    .collection("eventRecords")
    .doc(data.eventId)
    .delete();
  const allInnerDocs = await db
    .collection("platforms")
    .doc(data.platformId)
    .collection("eventRecords")
    .doc(data.eventId)
    .collection("usersEventRecords")
    .get();
  const batchSize = allInnerDocs.size;
  if (batchSize == 0) return;
  const batch = db.batch();
  allInnerDocs.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();
});

//data: {platformId: , eventId: , groupId: , answers: []}
exports.submitAnswers = functions.https.onCall(async (data, context) => {
  //Step 1: Check if it is past submission deadline. If so, errorType of 1. Also, when fetching the event doc, get the name and description of the event.
  var eventDoc = await db
    .collection("platforms")
    .doc(data.platformId)
    .collection("events")
    .doc(data.eventId)
    .get();
  if (!eventDoc.exists)
    return {
      isError: true,
      errorType: 3,
    };
  if (new Date().getTime() > eventDoc.data().endTime.toDate().getTime()) {
    return {
      isError: true,
      errorType: 1,
    };
  }
  var eventName = eventDoc.data().name;
  var eventDescription = eventDoc.data().description;

  //Step 2: get the event records, so you can compare answers to the exact questions given.
  var recordQuestions = [];
  var doc = await db
    .collection("platforms")
    .doc(data.platformId)
    .collection("eventRecords")
    .doc(data.eventId)
    .collection("usersEventRecords")
    .doc(context.auth.uid)
    .get();

  if (!doc.exists) {
    return {
      isError: true,
      errorType: 2,
    };
  }
  var eventRecords = doc.data()["questions"];

  //Step 3: fill out the question records by looping through each of the questions on record, and adding them to the recordQuestions var, checking if they are right or wrong.
  var index = 0;
  eventRecords.forEach((q) => {
    if (!q || q.isError) recordQuestions[index] = { isError: true };
    else {
      recordQuestions[index] = {
        isCorrect: q.answers.includes(String(data.answers[index])),
        points: Number(q.points),
        dbId: q.dbId,
        questionId: q.questionId,
        answer: String(data.answers[index]),
        acceptedAnswers: q.answers,
        text: q.text,
        imageURLs: q.imageURLs,
      };
    }
    index++;
  });

  //Step 4: get the user doc, and do checks. Check if: no currentGroup ORD already done this event in some group (cannot submit, can only do event once across the platform, and only submit for one group)
  //Don't return any feedback records, this is just a submitAnswers function.
  var userData = await db
    .collection("platforms")
    .doc(data.platformId)
    .collection("users")
    .doc(context.auth.uid)
    .get();
  var group = userData.data().currentGroup;
  //if the group is null, then no group is joined
  if (!group) return { isError: true, errorType: 5 };

  //if already submitted, return.
  if (
    userData.data().completedEvents &&
    userData.data().completedEvents.includes(data.eventId)
  ) {
    return { isError: true, errorType: 4 };
  }

  // var existingUserRecords = await getUserRecords(
  //   data.platformId,
  //   context.auth.uid,
  //   data.eventId
  // );
  // if (!existingUserRecords.isFirstTime) return { isError: true, errorType: 4 };

  //Step 5: add the records, in a separate document.
  await userData.ref.collection(group).doc(data.eventId).set({
    questions: recordQuestions,
    timeSubmitted: admin.firestore.FieldValue.serverTimestamp(),
    eventId: data.eventId,
    eventName: eventName,
    eventDescription: eventDescription,
  });

  //Step 6: add it to completedEvents, so it cannot be completed again, even in another group
  userData.ref.update({
    completedEvents: admin.firestore.FieldValue.arrayUnion(data.eventId),
  });

  //Step 7: update the stats (in the user doc)
  var correctPoints = 0;
  var totalEventPoints = 0;
  recordQuestions.forEach((q) => {
    totalEventPoints += q.points;
    if (q.isCorrect) {
      correctPoints += q.points;
    }
  });
  var statsUpdates = {
    lastEvent: {
      questions: recordQuestions,
      timeSubmitted: admin.firestore.FieldValue.serverTimestamp(),
      eventId: data.eventId,
      eventName: eventName,
      eventDescription: eventDescription,
    },
    totalPoints: admin.firestore.FieldValue.increment(correctPoints),
    totalPossiblePoints: admin.firestore.FieldValue.increment(totalEventPoints),
    totalEvents: admin.firestore.FieldValue.increment(1),
  };
  await userData.ref
    .collection(group)
    .doc("userData")
    .set({ ...statsUpdates }, { merge: true });
  return {
    isError: false,
  };
});
//returns Object { isError: , errorType: 1 - deadline passed; 2 - event records not found; 3 - event not found, 4 - already submitted, 5 - not registered in database }

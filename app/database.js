/**
 * Copyright (C) 2017 Menome Technologies.
 *
 * Contains shared code for contacting the Neo4j Database.
 * All other API code references this so that we only have one driver open per API instance.
 */
var neo4j = require('neo4j-driver').v1;
var conf = require('./config');
var uuidV4 = require('uuid/v4');

var driver = neo4j.driver(conf.neo4j.url, neo4j.auth.basic(conf.neo4j.user, conf.neo4j.pass));

module.exports = {
  query,
  genUuid: uuidV4,
}

// Generic way for app to schedule queries, while getting passed any errors.
// Accepts a callback cb(err,result)
function query(queryStr, queryParams, cb) {
  var session = driver.session();
  return session
    .run(queryStr, queryParams)
    .then(function (result) {
        session.close();
        if(!!cb) cb(null, result);
        return result
      },
      function (err) {
        session.close();
        if(!!cb) cb(err, null);
        throw err
      });
};
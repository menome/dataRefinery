// Turn off logging for tests.
var logger = require('../app/logger');
logger.logging = false;
var assert = require('chai').assert;
var rabbitListener = require('../app/listener'); // For listening to AMQP messages

var mock = require('mock-require');

mock('./messageHandler', {handleMessage: function(message) { return Promise.resolve(true) }} )

var invalidJson = "{{notRight: true}}";
var noSchemaJson = '{ "Name":21, "NodeType":"Employee", "Priority": 1, "ConformedDimensions": { "Email": "konrad.aust@menome.com", "EmployeeId": 12345 }, "Properties": { "Status":"active" }, "Connections": [ { "Name": "Menome Victoria", "NodeType": "Office", "RelType": "LocatedInOffice", "ForwardRel": true, "ConformedDimensions": { "City": "Victoria" } }, { "Name": "theLink", "NodeType": "Project", "RelType": "WorkedOnProject", "ForwardRel": true, "ConformedDimensions": { "Code": "5" } } ] }';
var schemaConformJson = '{ "Name": "Konrad Aust", "NodeType":"Employee", "Priority": 1, "ConformedDimensions": { "Email": "konrad.aust@menome.com", "EmployeeId": 12345 }, "Properties": { "Status":"active" }, "Connections": [ { "Name": "Menome Victoria", "NodeType": "Office", "RelType": "LocatedInOffice", "ForwardRel": true, "ConformedDimensions": { "City": "Victoria" } }, { "Name": "theLink", "NodeType": "Project", "RelType": "WorkedOnProject", "ForwardRel": true, "ConformedDimensions": { "Code": "5" } } ] }';

describe('Handle Message', function () {
  it('Rejects invalid JSON', function (done) {
    rabbitListener.handleMessage({content: invalidJson}).then((result) => {
      assert.isFalse(result);
      done();
    })
  });

  it('Rejects JSON that does not conform to schema', function (done) {
    rabbitListener.handleMessage({content: noSchemaJson}).then((result) => {
      assert.isFalse(result);
      done();
    })
  });

  it('Accepts JSON that does conform to schema', function (done) {
    rabbitListener.handleMessage({content: schemaConformJson}).then((result) => {
      assert.isTrue(result);
      done();
    })
  });
});
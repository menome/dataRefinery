// JSON Schema for incoming messages.
// Messages that don't pass this get rejected.
const messageSchema = {
  // "$schema":"http://json-schema.org/draft-06/schema#",
  "title": "tldrmessage",
  "type": "object",
  "required": ["Name","NodeType","ConformedDimensions"],
  "additionalProperties": false,
  "properties": {
    "Name": {
      "type": "string",
      "pattern": "^[a-zA-Z0-9_\\s]*$"
    },
    "NodeType": {
      "type": "string",
      "pattern": "^[a-zA-Z0-9_]*$"
    },
    "ConformedDimensions": {
      "type": "object"
    },
    "Properties": {
      "type": "object"
    },
    "Connections": {
      "type": "array"
    },
    "Priority": {
      "type": "number",
      "minimum": 0
    }
  }
}

module.exports = {
  messageSchema
}
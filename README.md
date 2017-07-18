# TheLink - dataRefinery

This turns specifically formatted AMQP messages into neo4j graph updates.

### Example Message Format
```
{
  "Name":"Konrad Aust",
  "NodeType":"Employee",
  "Priority": 1,
  "ConformedDimensions": {
    "Email": "konrad.aust@menome.com",
    "EmployeeId": 12345
  },
  "Properties": {
    "Status":"active"
  },
  "Connections": [
    {
      "Name": "Menome Victoria",
      "NodeType": "Office",
      "RelType": "LocatedInOffice",
      "ForwardRel": true,
      "ConformedDimensions": {
        "City": "Victoria"
      }
    },
    {
      "Name": "theLink",
      "NodeType": "Project",
      "RelType": "WorkedOnProject",
      "ForwardRel": true,
      "ConformedDimensions": {
        "Code": "5"
      }
    }
  ]
}
```

### Explanation

The graph updates should be incremental. Because of this, queries generated rely heavily on merge statements.

Merge statements require a 'conformed dimension' which is a property that can uniquely identify the node. For a user, that dimension may be their email or user ID. For a project, it may be the project number. Conformed dimensions should be unique and consistent across all systems.

Messages can be given a 'priority.' This is an integer. Higher priority messages will overwrite existing data that was tagged with a lower priority.

Connections are a list of other nodes with conformed dimensions that we should merge on. 
Each of these mirrors the top-level structure, but can not possess its own connections object.

### Configuration

Configuration can be specified either through environment variables, or through a JSON config file, located at config/conf.json.

Environment variables will always overwrite JSON configs. If neither are found, defaults will be loaded.

#### Environment Variables:
```
NEO4J_URL=the URL of the neo4j instance. eg. "bolt://neo4j"
NEO4J_USERNAME=the username we're using to connect to neo4j. eg. 'neo4j'
NEO4J_PASSWORD=the password for the user account. eg. 'swordfish'
RABBIT_URL=the URL of the RMQ server. eg. 'amqp://rabbitmq:rabbitmq@rabbit:5672?heartbeat=3600'
```

#### Example JSON Configuration:
```
{
  "neo4j": {
    "url": "bolt://neo4j",
    "user": "neo4j",
    "pass": "swordfish"
  },
  "rabbit": {
    "url": "amqp://rabbitmq:rabbitmq@rabbit:5672?heartbeat=3600",
    "routingKey": "syncevents.harvester.updates",
    "exchange": "syncevents"
  },
  "maxConcurrentQueries": 5
}
```

## Possible Concerns
There is currently no way to handle deletion of nodes from source systems. We can either:
  * Create a new message schema that allows for deletion
  * Timestamp nodes on every import, so we know that certain nodes only existed prior to a certain date.

There is also currently no way to prevent systems with conflicting parameters from interfering with data. For example, if two different systems store a 'lastname' property for a person, and that person's last name changes, then each sync, the lastname that gets put into the graph for that person is whichever sync message was parsed later.
  * One could timestamp the messages
  * Assign a priority to messages, eg. The accounting system could be a lower priority than the HR database for employee parameters. This gets a little confusing in terms of managing priority and state, especially if we want to do it on a per-property basis.

I'm open to solutions for either of these problems.
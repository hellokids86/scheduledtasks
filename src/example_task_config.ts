

export default [
    {
        groupName: "Test Group",
        cron: "*/5 * * * *",
        tasks: [
            {
                name: "Test Task",
                filePath: "src/TestTask.ts",
                params: {
                    testParam: "hello world"
                },
                warningHours: 0.1,
                errorHours: 0.05
            }
        ]
    },
     {
        groupName: "Test Group With Error",
        cron: "*/5 * * * *",
        tasks: [

                {
                name: "Test Error Task",
                filePath: "src/TestErrorTask.ts",
                params: {
                    testParam: "hello world"
                },
                warningHours: 0.1,
                errorHours: 0.05,
                killOnFail: true
            },
            {
                name: "Test Task After Error",
                filePath: "src/TestTask.ts",
                params: {
                    testParam: "hello world"
                },
                warningHours: 0.1,
                errorHours: 0.05,
                killOnFail: false
            }
        ]
    }
]
